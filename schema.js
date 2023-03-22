// how refs collisions handled?
// i found this info:
// https://json-schema.org/draft/2020-12/json-schema-core.html#section-7.7.1.1

export class Schema {
    constructor(schema){
        this.schema = schema;
        this.id = schema.$id;
    }
    validate(value) {
        return !this.error(value);
    }
    *errors (value){
        return yield* errors(value, this.schema);
    }
    error(value) {
        for (const error of this.errors(value)) return error;
    }

    async deref() {
        this.findIds();
        await this.#loadRefs();
        this.#_deref(this.schema);
    }
    #_deref(schema) {
        if (!schema) return;
        for (const [prop, value] of Object.entries(schema)) {
            if (prop === '$ref') {
                if (typeof value === 'object') continue; // already dereferenced
                let subSchema;
                if (value[0] !== '#') {
                    const url = this.refToUrl(value);
                    const foraignSchema = this.foraignSchemas.get(url);
                    subSchema = foraignSchema.walk(value.split('#')[1]||'');
                } else {
                    subSchema = this.walk(value.substring(1));
                }
                if (subSchema == null) {
                    console.error('Subschema not found', value, schema);
                    continue;
                }
                schema.$ref = subSchema;
            } else if (prop === 'properties') {
                for (const propSchema of Object.values(value)) {
                    this.#_deref(propSchema);
                }
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    this.#_deref(item);
                }
            } else if (typeof value === 'object') {
                this.#_deref(value);
            }
        }
    }
    walk(fullpath) {
        const [anchor, ...path] = fullpath.split('/');
        const subSchema = this.anchors.get(anchor);
        if (subSchema === undefined) return;
        //if (subSchema === undefined) throw new Error(`Anchor "${anchor}" not found`);
        return walk(subSchema, path);
    }
    findIds() {
        this.#_findIds(this.schema, this.id);
    }
    #_findIds(schema, parentId) {
        if (!schema) return;
        for (const [prop, value] of Object.entries(schema)) {
            if (prop === '$id') {
                const url = new URL(value, parentId);
                schema[prop] = url.toString(); // replace with absolute url
                if (AllSchemas.has(url.href)) continue;
                const IdSchema = new Schema(schema);

                //AllSchemas.set(url.href, IdSchema.deref().then(() => IdSchema)); // we can not immediately deref as it will be infinite loop, but the Schema-Promise should be there
                const promise = new Promise((resolve) => {
                    queueMicrotask(() => {
                        IdSchema.deref();
                        resolve(IdSchema);
                    });
                });
                AllSchemas.set(url.href, promise);
            } else if (prop === 'const') {
                return;
            } else if (prop === 'properties') {
                for (const propSchema of Object.values(value)) {
                    this.#_findIds(propSchema, schema.$id || parentId);
                }
            } else if (Array.isArray(value)) {
                // no need to check array items
            } else if (typeof value === 'object') {
                this.#_findIds(value, schema.$id || parentId);
            }
        }
    }

    async #loadRefs(){ // and anchors and ids
        this.anchors = new Map([['', this.schema]]);

        const promises = this.#_loadRefs(this.schema);
        const schemasArray = await Promise.all(promises.values()); // .catch(console.error);
        const keySchemas = new Map();
        for (const [key] of promises) {
            keySchemas.set(key, schemasArray.shift());
        }
        this.foraignSchemas = keySchemas;
    }
    #_loadRefs(schema) {
        const refs = new Map();
        if (!schema) return refs;

        for (const [prop, value] of Object.entries(schema)) {
            if (prop === '$anchor') {
                this.anchors.set(value, schema);
            }
            if (prop === 'enum') continue;
            if (prop === 'const') continue;
            if (typeof value === 'object') {
                for (const [url, promise] of this.#_loadRefs(schema[prop])) {
                    refs.set(url, promise);
                }
                continue;
            }
            if (prop === '$ref') {
                if (typeof value === 'object') continue; // already dereferenced
                if (value[0] !== '#') {
                    const url = this.refToUrl(value);
                    refs.set(url, loadSchema(url));
                }
            }
        }
        return refs;
    }
    refToUrl(ref) {
        ref = ref.replace(/#.*/, '');
        // absolute url
        if (ref.match(/^[a-z]+:/)) return ref;
        // relative url
        return this.id.replace(/\/[^/]*$/, '') + '/' + ref;
    }
}

const unevaluatedPropertiesFor = new WeakMap();
let stopCollectingEvaluated = false; // for inside "not"

export function *errors (value, schema){
    if (schema === false) { yield 'Schema is false'; return; }
    if (schema === true) return;
    if (typeof schema !== 'object') {
//        throw new Error('Schema is not an object');
        console.error('Schema is not an object', schema);
        return;
    }
    //delete schema.$comment; // remove comments to ensure they are not used by the user of the schema
    let type = typeof value;
    if (value === null) type = 'null';
    if (Array.isArray(value)) type = 'array';

    if (type === 'object' && 'unevaluatedProperties' in schema) {
        if (!unevaluatedPropertiesFor.has(value)) {
            unevaluatedPropertiesFor.set(value, new Set(Object.keys(value)));
        }
    }
    if (type === 'array' && 'unevaluatedItems' in schema) {
        if (!unevaluatedPropertiesFor.has(value)) {
            unevaluatedPropertiesFor.set(value, new Set(value));
        }
    }

    for (const prop of Object.keys(schema)) {
        const validator = validators[prop];
        if (validator) {
            if (relevantFor[prop] && !relevantFor[prop].includes(type)) continue;

            if (validator instanceof GeneratorFunction) {
                yield* validator(schema[prop], value, schema);
            } else {
                const valide = validator(schema[prop], value, schema);
                if (!valide) {
                    try {
                        yield `"${value}" does not match ${prop}:${schema[prop]}`; // value to sting can fail
                    } catch {
                        yield `"object does not match ${prop}:${schema[prop]}`;
                    }
                }
            }
        }
    }

    if (typeValidators[type]) {
        yield* typeValidators[type](schema, value);
    }

    if (type === 'object' && 'unevaluatedProperties' in schema) {
        for (const prop of unevaluatedPropertiesFor?.get(value) || []) {
            yield* errors(value[prop], schema.unevaluatedProperties);
        }
        unevaluatedPropertiesFor.delete(value);
    }
    if (type === 'array' && 'unevaluatedItems' in schema) {
        for (const item of unevaluatedPropertiesFor?.get(value) || []) {
            console.log('unevaluated:', item, schema.unevaluatedItems)
            yield* errors(item, schema.unevaluatedItems);
        }
        unevaluatedPropertiesFor.delete(value);
    }

}


const relevantFor = {
    multipleOf: ['number'], // integer is also a number
    minimum: ['number'],
    maximum: ['number'],
    exclusiveMinimum: ['number'],
    exclusiveMaximum: ['number'],
    minLength: ['string'],
    maxLength: ['string'],
    pattern: ['string'],
    format: ['string'],
    contentEncoding: ['string'],
}


const typeValidators = {
    *object(schema, value) {
        const keys = Object.keys(value);
        if ('minProperties' in schema) {
            if (keys.length < schema.minProperties) yield "Object has less properties than minProperties";
        }
        if ('maxProperties' in schema) {
            if (keys.length > schema.maxProperties) yield "Object has more properties than maxProperties";
        }
        if ('required' in schema) {
            for (const prop of schema.required) {
                if (!keys.includes(prop)) yield `Object is missing required property "${prop}"`;
            }
        }
        if ('dependentRequired' in schema) {
            for (const [prop, required] of Object.entries(schema.dependentRequired)) {
                if (keys.includes(prop)) {
                    for (const req of required) {
                        if (!keys.includes(req)) yield `Object is missing required property "${req}" (dependent on "${prop}")`;
                    }
                }
            }
        }
        if ('dependentSchemas' in schema) {
            for (const [prop, subSchema] of Object.entries(schema.dependentSchemas)) {
                if (keys.includes(prop)) {
                    yield* errors(value, subSchema);
                }
            }
        }
        const patternProperties = schema.patternProperties && Object.entries(schema.patternProperties);
        const propertyNames = schema.propertyNames;
        for (const prop of keys) {
            let additional = true;
            const propSchema = schema?.properties?.[prop];
            if (propSchema != null) {
                yield* errors(value[prop], propSchema);
                additional = false;
            }
            if (patternProperties) {
                for (const [pattern, subSchema] of patternProperties) {
                    if (new RegExp(pattern,'u').test(prop)) {
                        yield* errors(value[prop], subSchema);
                        additional = false;
                    }
                }
            }
            if (additional && 'additionalProperties' in schema) {
                if (schema.additionalProperties === false) { // TODO: false equals false schema, so this can be removed
                    yield `Object has additional property "${prop}"`;
                } else {
                    yield* errors(value[prop], schema.additionalProperties);
                }
                additional = false; // evaluated
            }

            if (!additional) {
                if (!stopCollectingEvaluated) {
                    unevaluatedPropertiesFor.get(value)?.delete(prop);
                }
            }

            if (propertyNames != null) {
                if (propertyNames===false) yield "property name '" + prop + "' is not allowed";
                yield* errors(prop, propertyNames);
            }
        }

    },
    *array(schema, value) {

        if ('minItems' in schema) {
            if (value.length < schema.minItems) yield "Array has less items than minItems";
        }
        if ('maxItems' in schema) {
            if (value.length > schema.maxItems) yield "Array has more items than maxItems";
        }

        const uniqueSet = schema.uniqueItems && new Set();

        let numContains = 0;
        const minContains = schema.minContains ?? 1;
        const maxContains = schema.maxContains ?? Infinity;

        let i = 0;
        for (const item of value) {

            let evaluated = false;

            if (schema.prefixItems?.[i] != null) {
                yield* errors(item, schema.prefixItems[i]);
                evaluated = true;
            } else {
                if (schema.items != null) {
                    yield* errors(item, schema.items);
                    evaluated = true;
                }
            }
            if (uniqueSet) {
                const uValue = typeof item === 'object' && item != null ? 'hack'+JSON.stringify(item) : item; // todo: order of keys are not relevant, but JSON.stringify does not sort them
                if (uniqueSet.has(uValue)) yield "Array has duplicate items";
                uniqueSet.add(uValue);
            }
            if (schema.contains != null) {
                const match = errors(item, schema.contains).next().done;
                if (match) {
                    evaluated = true;
                    numContains++;
                }
                //if (numContains >= minContains && maxContains === Infinity) return;
            }

            if (evaluated) {
                if (!stopCollectingEvaluated) {
                    console.log('delete', item)
                    unevaluatedPropertiesFor.get(value)?.delete(item);
                }
            }

            i++;
        }
        if (schema.contains != null) {
            if (numContains < minContains) yield 'Array contains too few items that match "contains"';
            if (numContains > maxContains) yield 'Array contains too many items that match "contains"';
        }
    },

}

const validators = {
    *$ref(subSchema, value) {
        return yield* errors(value, subSchema);
    },
    enum: (allowed, value) => {
        for (const a of allowed) if (deepEqual(a, value)) return true;
    },
    const: (constant, value) => {
        return deepEqual(value, constant);
    },
    type: (type, value) => {
        if (Array.isArray(type)) {
            for (const t of type) if (validators.type(t, value)) return true;
        }
        if (type === 'integer' && Number.isInteger(value)) return true;
        if (type === 'number'  && typeof value === 'number' && isFinite(value)) return true;
        if (type === 'boolean' && typeof value === 'boolean') return true;
        if (type === 'string'  && typeof value === 'string') return true;
        if (type === 'array'   && Array.isArray(value)) return true;
        if (type === 'object'  && typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
        if (type === 'null'    && value == null) return true;
    },

    // number
    multipleOf: (mOf, value) => {
        if (Number.isInteger(value) && Number.isInteger(1 / mOf)) return true; // all integers are multiples of 0.5, if overflow is handled
        if (Number.isInteger(value / mOf)) return true;
    },
    minimum: (min, value) => value >= min,
    maximum: (max, value) => value <= max,
    exclusiveMinimum: (min, value) => value > min,
    exclusiveMaximum: (max, value) => value < max,

    // string
    minLength: (minLen, value) => [...value].length >= minLen,
    maxLength: (maxLen, value) => [...value].length <= maxLen,
    pattern: (pattern, value) => {
        return new RegExp(pattern,'u').test(value);
    },

    // others:
    // https://github.com/korzio/djv/blob/master/lib/utils/formats.js
    // https://github.com/sagold/json-schema-library/blob/042867abef41b519571bbe082087116e007a23d5/dist/module/lib/validation/format.js
    format: (format, value) => {
        switch (format) {
            case 'date-time': return validDateTime(value);
            case 'date': return validDate(value);
            case 'time': return validTime(value);
            case 'duration': return parseDuration(value);
            case 'email':
            case 'idn-email': return isValidEmail(value, format==='idn-email');
            case 'ipv4': return isValidIPv4(value);
            case 'ipv6': return isValidIPv6(value);
            case 'uri':
            case 'iri': try { new URL(value); return true; } catch { return false; }
            case 'uri-reference':
            case 'iri-reference': try { new URL(value, 'http://x.y'); return true; } catch { return false; }
            case 'uri-template': return /^([^\{\}]|\{[^\{\}]+\})*$/.test(value);
            case 'hostname': return isValidHostname(value);
            case 'idn-hostname': return isValidIdnHostname(value);
            case 'uuid': return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
            case 'json-pointer': return /^(?:\/(?:[^~/]|~0|~1)*)*$/.test(value);
            case 'relative-json-pointer': return /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/.test(value);
            case 'regex': try { new RegExp(value, 'u'); return true; } catch { return false; }
            default: console.warn('jsons chema unknown format: '+format);
        }
        return true;
    },
    contentEncoding(/*encoding, value*/) {
        return true;
        // switch (encoding) {
        //     // 7bit, 8bit, binary, quoted-printable, base16, base32, and base64
        //     case '7bit': return /^[\x00-\x7F]+$/.test(value); // 0-127 (ascii)
        //     case '8bit': return /^[\x00-\xFF]+$/.test(value); // 0-255 (extended ascii)
        //     case 'binary': return /^[\x00-\xFF]+$/.test(value); // 0-255
        //     case 'quoted-printable': return /^[\x09\x20-\x3C\x3E-\x7E]+$/.test(value); // 9, 32-60, 62-126
        //     case 'base16': return /^[0-9a-fA-F]+$/.test(value); // 0-9, a-f, A-F
        //     case 'base32': return /^[0-9a-vA-V]+$/.test(value); // 0-9, a-v, A-V
        //     case 'base64': return /^[0-9a-zA-Z+/=]+$/.test(value); // 0-9, a-z, A-Z, +, /
        // }
    },

    // combiners
    *allOf(allOf, value) {
        for (const subSchema of allOf) {
            yield* errors(value, subSchema);
        }
    },
    anyOf(anyOf, value) {
        const collecting = unevaluatedPropertiesFor.has(value);

        let any = false;
        for (const subSchema of anyOf) {
            const ok = errors(value, subSchema).next().done;
            //const ok = [...errors(value, subSchema)].length === 0; // no need? zzz
            if (ok) {
                if (!collecting) return true;
                any = true;
            }
        }
        return any;
    },
    oneOf(oneOf, value) {
        let pass = 0;
        for (const subSchema of oneOf) {
            pass += [...errors(value, subSchema)].length ? 0 : 1;
            if (pass > 1) return false;
        }
        return pass === 1;
    },
    not(subschema, value) {
        stopCollectingEvaluated = true;
        for (const _error of errors(value, subschema)) {
            stopCollectingEvaluated = false;
            return true;
        }
    },
    deprecated(deprecated, value, schema) {
        if (deprecated) console.error("deprecated (value: " + value + "))", schema);
        return true;
    },
    *if(ifSchema, value, schema) {
        // no if, no else and not collecting unevaluatedProperties
        if (!schema.then && !schema.else && !unevaluatedPropertiesFor.has(value)) return;
        if (errors(value, ifSchema).next().done) {
            if (schema.then != null) yield* errors(value, schema.then);
        } else {
            if (schema.else != null) yield* errors(value, schema.else);
        }
    },
};


/* helpers */
const GeneratorFunction = (function*(){}).constructor;

const AllSchemas = new Map();
function loadSchema(url) {
    if (AllSchemas.has(url)) {
        return Promise.resolve(AllSchemas.get(url));
    } else {
        const promise = fetch(url).then(res => res.json()).then(async data => {
            const schema = new Schema(data);
            await schema.deref();
            return schema;
        });
        AllSchemas.set(url, promise);
        return promise;
    }
}
window.AllSchemas = AllSchemas;


function walk(schema, parts) {
    let subSchema = schema;
    for (let part of parts) {
        part = part.replace(/~1/g, '/').replace(/~0/g, '~').replace(/%25/g, '%').replace(/%22/g, '"');
        subSchema = subSchema[part];
        if (subSchema == null) {
            const msg = 'path "' + parts.join('/') + '" not found in schema (at part "' + part + '")';
            console.warn(msg, schema);
        }
    }
    return subSchema;
}

// function deepMixin(target, source) {
//     for (const [prop, value] of Object.entries(source)) {
//         if (typeof value === 'object') {
//             if (!target[prop]) target[prop] = {};
//             deepMixin(target[prop], value);
//         } else {
//             target[prop] = value;
//         }
//     }
// }



function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null && b != null) return false;
    if (a != null && b == null) return false;
    if (typeof a === 'object' && typeof b === 'object') {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!deepEqual(a[i], b[i])) return false;
            }
            return true;
        } else {
            const aKeys = Object.keys(a);
            const bKeys = Object.keys(b);
            if (aKeys.length !== bKeys.length) return false;
            for (const key of aKeys) {
                if (!deepEqual(a[key], b[key])) return false;
            }
            return true;
        }
    }
    return false;
}
function validDate(value) {
    const x = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!x) return false;
    const [year, month, day] = x.slice(1);
    if (month > 12) return false;
    if (day > 31) return false;
    if (day > 28) {
        const maxDays = new Date(year, month, 0).getDate();
        if (day > maxDays) return false;
    }
    return true;
}
function validTime(value) {
    const x = value.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([\+-]\d{2}):(\d{2}))$/i);
    if (!x) return false;
    const [hours, minutes, seconds, offsetHours, offsetMinutes] = x.slice(1);
    if (hours > 23) return false;
    if (minutes > 59) return false;
    if (seconds > 60) return false;
    if (offsetHours!=null) {
        if (offsetHours > 23) return false;
        if (offsetHours < -23) return false;
        if (offsetMinutes === undefined) return false;
        if (offsetMinutes > 59) return false;
    }
    if (seconds == '60') {
        const minutesUtf = minutes*1 + -(offsetMinutes || 0);
        const hoursUtf   = hours*1 + -(offsetHours || 0);
        if (minutesUtf !== 59 && minutesUtf !== -1) return false;
        if (hoursUtf !== 23 && hoursUtf !== 0) return false;
    }
    return true;
}
function validDateTime(value) {
    const [date, time] = value.split(/T/i);
    if (!validDate(date)) return false;
    if (!validTime(time)) return false;
    return true;
}

function isValidHostname(hostname) {
    if (!hostname || hostname.length > 255) return false;
    const regex = /^[a-zA-Z0-9\-.]+$/;
    if (!regex.test(hostname)) return false;
    const labels = hostname.split(".");
    for (const label of labels) {
        if (!label || label.length > 63) return false;
        if (label[0] === "-" || label.at(-1) === "-") return false;
    }
    return true;
}

function isValidIdnHostname(hostname) {
    try { new URL('http://' + hostname); }
    catch { return false; }
    const lableFails = hostname.split('.').some(x => {
        if (x.length > 63) return true;
        if (x.substring(2, 4) === '--') return true;
    })
    if (lableFails) return false;

    // Hebrew GERSHAYIM not preceded by anything
    if (hostname.match(/(?<!.)\u05F4/)) return false;
    //Hebrew GERESH not preceded by Hebrew
    if (hostname.match(/(?<![\p{Script=Hebrew}])\u05F3/u)) return false;

    // Greek KERAIA not followed by anything
    //if (hostname.match(/\u0375(?!.)/)) return false;
    // Greek KERAIA not followed by Greek
    if (hostname.match(/\u0375(?![\p{Script=Greek}])/u)) return false;

    if (hostname.includes('\u302E')) return false;
    if (hostname.startsWith('-')) return false;
    if (hostname.endsWith('-')) return false;
    if (hostname === '・') return false;
    if (hostname.includes('・')) {
        if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(hostname)) {
           return false;
        }
    }
    if (hostname.includes('·')) {
        if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(hostname)) {
           return false;
        }
    }
    return true;
}
function isValidIPv4(ip) {
    return /^((?!0\d)\d{1,3}\.){3}(?!0\d)\d{1,3}$/.test(ip) && ip.split('.').every(p => p >= 0 && p <= 255);
}
function isValidIPv6(ip) {
    try { new URL(`http://[${ip}]`); return true; }
    catch { return false; }
}
function isValidEmail(value, idn) {
    // try { new URL(`mailto:${value}`); return true; }
    // catch { return false; }
    const index = value.lastIndexOf('@');
    const local = value.substring(0, index);
    const domain = value.substring(index + 1);
    if (local==='') return false;
    if (domain[0] === '[' && domain.at(-1) === ']') {
        if (domain.startsWith('[IPv6:')) {
            if (!isValidIPv6(domain.slice(6,-1))) return false;
        } else {
            if (!isValidIPv4(domain.slice(1,-1))) return false;
        }
    } else if (idn) {
        if (!isValidIdnHostname(domain)) return false;
    } else {
        if (!isValidHostname(domain)) return false;
    }
    return /^(?!\.)("([^"\r\\]|\\["\r\\])*"|([-a-z0-9!#$%&'*+/=?^_`{|}~]|(?<!\.)\.)*)(?<!\.)$/.test(local);
}

function parseDuration(duration) {
    // use Temporal.Duration.from(duration) when it's available
    const [datePart, timePart] = duration.split('T');
    const dateRegex = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/;
    const dateMatches = datePart.match(dateRegex);
    if (!dateMatches) return null;
    const [, years, months, weeks, days] = dateMatches;
    if (weeks != null && (years != null || months != null || days != null)) return null; // weeks can't be combined with other units
    if (timePart === '') return null;
    const timeRegex = /^(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
    const timeMatches = timePart?.match(timeRegex) ?? [];
    // if (!timeMatches) return null;
    const [, hours, minutes, seconds] = timeMatches;
    if (years == null && months == null && weeks == null && days == null && hours == null && minutes == null && seconds == null) return null;
    return {years, months, weeks, days, hours, minutes, seconds};
    // return {
    //     years: parseInt(years??0),
    //     months: parseInt(months??0),
    //     weeks: parseInt(weeks??0),
    //     days: parseInt(days??0),
    //     hours: parseInt(hours??0),
    //     minutes: parseInt(minutes??0),
    //     seconds: parseInt(seconds??0),
    // };
}
