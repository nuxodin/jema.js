// how refs collisions handled?
// i found this info:
// https://json-schema.org/draft/2020-12/json-schema-core.html#section-7.7.1.1

const refKey = Symbol('ref');
const defaultLocation = window?.location?.href || 'http://localhost/'; // OK? TODO?
let currentSchema = null;

// AllSchemas is a global map of all loaded schemas
export const AllSchemas = new Map();
function loadSchema(url) {
    if (!AllSchemas.has(url)) {
        const promise = fetch(url).then(res => res.json()).then(async data => {
            const schema = new Schema(data);
            await schema.deref();
            return schema;
        });
        AllSchemas.set(url, promise);
    }
    return AllSchemas.get(url);
}


export class Schema {
    constructor(schema){
        this.schema = schema;
        this.id = schema.$id;

        this.anchors = new Map([['', this.schema]]); // including itself as "#"
        this.dynAnchors = new Map();

        this.#findAnchors(this.schema);
    }
    validate(value) {
        return !this.error(value);
    }
    *errors (value){
        currentSchema = this;
        return yield* errors(value, this.schema);
    }
    error(value) {
        return this.errors(value).next().value??false;
    }

    #findAnchors(schema) {
        if (schema.$id && schema.$id !== this.id) return;
        if (schema.$anchor && !this.anchors.has(schema.$anchor)) this.anchors.set(schema.$anchor, schema);
        if (schema.$dynamicAnchor && !this.dynAnchors.has(schema.$dynamicAnchor)) this.dynAnchors.set(schema.$dynamicAnchor, schema);
        for (const sub of subSchemas(schema)) this.#findAnchors(sub);
    }


    #findIds(schema, base) { // only root-schema has to do it
        if (schema.$id) {
            const url = new URL(schema.$id, base);
            base = schema.$id = url.toString();
            if (!AllSchemas.has(url.href)) {
                const IdSchema = new Schema(schema);
                //AllSchemas.set(url.href, IdSchema.deref().then(() => IdSchema)); // we can not immediately deref as it will be infinite loop, but the Schema-Promise should be there
                const promise = new Promise((resolve) => {
                    queueMicrotask(() => {
                        IdSchema.deref();
                        resolve(IdSchema);
                    });
                });
                AllSchemas.set(url.href, promise);
            }
        }
        for (const sub of subSchemas(schema)) this.#findIds(sub, base);
    }


    async deref() {
        this.#findIds(this.schema, defaultLocation);
        const promises = this.#loadRefs(this.schema);
        this.foraignSchemas = await promisesAllMap(promises);
        this.#deref(this.schema);
    }
    #deref(schema) {
        //if (schema.$id && schema.$id !== this.id) return;
        if (schema.$ref && !schema[refKey]) {
            const ref = schema.$ref;
            const refSchema = this.walk(ref);
            if (refSchema == null) console.error('$ref-schema not found', ref, schema);
            schema[refKey] = refSchema;
        }
        // dynamicRef
        if (schema.$dynamicRef && !schema[refKey]) {
            const ref = schema.$dynamicRef;
            const refSchema = this.walk(ref);
            if (refSchema == null) console.error('$dynamicRef-schema not found', ref, schema);
            schema[refKey] = refSchema;
        }

        for (const sub of subSchemas(schema)) this.#deref(sub);
    }

    #loadRefs(schema) {
        //if (schema.$id && schema.$id !== this.id) return;
        const refs = new Map();
        if (schema.$ref && !schema[refKey]) { // not already dereferenced
            if (schema.$ref[0] !== '#') {
                const {url} = this.relativeUrl(schema.$ref);
                refs.set(url, loadSchema(url));
            }
        }
        for (const sub of subSchemas(schema)) {
            this.#loadRefs(sub).forEach((value, key) => refs.set(key, value));
        }
        return refs;
    }

    walk(ref, options) {
        if (ref[0] !== '#') { // walk an other schema
            const {url, hash} = this.relativeUrl(ref);
            const foraignSchema = this.foraignSchemas.get(url);
            if (!foraignSchema) console.warn('foraignSchema not found', url, ref);
            return foraignSchema.walk(hash);
        }
        const [anchor, ...path] = ref.substring(1).split('/');

        let subSchema;
        if (options?.dynamic) {
            subSchema = this.dynAnchors.get(anchor);
        } else {
            subSchema = this.anchors.get(anchor) || this.dynAnchors.get(anchor);
        }
        if (!subSchema) return;
        return walk(subSchema, path);
    }

    relativeUrl(ref) {
        const [url, hash=''] = new URL(ref, this.id).href.split('#');
        return {url, hash:'#'+hash};
    }
}



function *subSchemas(schema) {
    for (const [prop, value] of Object.entries(schema)) {
        const has = hasSubSchema[prop];
        if (has === 'object') for (const sub of Object.values(value)) yield sub;
        if (has === 'array') for (const sub of value) yield sub;
        if (has === true) yield value;
    }
}


const unevaluatedPropertiesFor = new WeakMap();
let stopCollectingEvaluated = false; // for inside "not"

export function *errors (value, schema){
    if (schema === false) { yield 'Schema is false'; return; }
    if (schema === true) return;
    if (typeof schema !== 'object') { console.error('Schema is not an object'); return; }

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
            // array to map (index to key) so we can remove evaluated items, do we only need a set of indexes?
            const map = new Map(value.map((obj, i) => [i, obj]));
            unevaluatedPropertiesFor.set(value, map);
        }
    }

    for (const prop of Object.keys(schema)) {
        const validator = validators[prop];
        if (!validator) continue;
        if (relevantFor[prop] && relevantFor[prop] !== type) continue;

        if (validator instanceof GeneratorFunction) {
            yield* validator(schema[prop], value, schema);
        } else {
            if (!validator(schema[prop], value, schema)) {
                yield `"${value}" does not match ${prop}:${schema[prop]}`; // value to sting can fail
            }
        }
    }

    if (typeValidators[type]) {
        yield* typeValidators[type](schema, value);
    }

    if (type === 'object' && 'unevaluatedProperties' in schema) {
        for (const prop of unevaluatedPropertiesFor.get(value) || []) {
            yield* errors(value[prop], schema.unevaluatedProperties);
        }
        unevaluatedPropertiesFor.delete(value);
    }
    if (type === 'array' && 'unevaluatedItems' in schema) {
        for (const [,item] of unevaluatedPropertiesFor.get(value) || []) {
            yield* errors(item, schema.unevaluatedItems);
        }
        unevaluatedPropertiesFor.delete(value);
    }

}



const hasSubSchema = {
    $defs: 'object',

    if: true,
    then: true,
    else: true,
    allOf: 'array',
    anyOf: 'array',
    oneOf: 'array',
    not: true,

    items: true,
    additionalItems: true,
    contains: true,
    prefixItems: 'array',
    unevaluatedItems: true,

    properties: 'object',
    required: true,
    additionalProperties: true,
    propertyNames: true,
    dependentSchemas: true,
    dependentRequired: true,
    unevaluatedProperties: true,
    patternProperties: true,
}

const relevantFor = {
    multipleOf: 'number', // integer is also a number
    minimum: 'number',
    maximum: 'number',
    exclusiveMinimum: 'number',
    exclusiveMaximum: 'number',
    minLength: 'string',
    maxLength: 'string',
    pattern: 'string',
    format: 'string',
    contentEncoding: 'string',
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

        const properties = schema.properties;
        const patternProperties = schema.patternProperties && Object.entries(schema.patternProperties);
        const propertyNames = schema.propertyNames;
        const additionalProperties = schema.additionalProperties;

        for (const prop of keys) {

            if (propertyNames != null) yield* errors(prop, propertyNames);

            let additional = true;

            const propSchema = properties?.[prop];
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
            if (additionalProperties != null && additional) {
                yield* errors(value[prop], additionalProperties);
                additional = false;
            }
            if (!additional && !stopCollectingEvaluated) {
                unevaluatedPropertiesFor.get(value)?.delete(prop);
            }
        }

    },
    *array(schema, value) {

        if ('minItems' in schema) {
            if (value.length < schema.minItems) yield "less array-items than minItems";
        }
        if ('maxItems' in schema) {
            if (value.length > schema.maxItems) yield "more array-items than maxItems";
        }

        const uniqueSet = schema.uniqueItems && new Set();

        let numContains = 0;
        const minContains = schema.minContains ?? 1;
        const maxContains = schema.maxContains ?? Infinity;

        for (const [i, item] of value.entries()) {

            if (schema.uniqueItems) {
                const uniqueValue = uniqueValueIgnoreKeyOrder(item);
                if (uniqueSet.has(uniqueValue)) yield "Array has duplicate items";
                uniqueSet.add(uniqueValue);
            }

            let additional = true;

            if (schema.prefixItems?.[i] != null) {
                yield* errors(item, schema.prefixItems[i]);
                additional = false;
            } else {
                if (schema.items != null) {
                    yield* errors(item, schema.items);
                    additional = false;
                }
            }

            if (schema.contains != null) {
                const match = errors(item, schema.contains).next().done;
                if (match) {
                    numContains++;
                    additional = false;
                } // TODO: early exits?
            }

            if (!additional) {
                if (!stopCollectingEvaluated) {
                    unevaluatedPropertiesFor.get(value)?.delete(i);
                }
            }
        }

        if (schema.contains != null) {
            if (numContains < minContains) yield 'Array contains too few items that match "contains"';
            if (numContains > maxContains) yield 'Array contains too many items that match "contains"';
        }
    },

}


const validators = {

    // meta data
    // title() {},
    // description() {},
    // default() {},
    // readOnly() {},
    // deprecated(deprecated, value, schema) {
    //     if (deprecated) console.error("deprecated (value: " + value + "))", schema);
    //     return true;
    // },
    // writeOnly() {},
    // examples() {},

    *$ref(url, value, schema) {
        const refSchema = schema[refKey];
        if (refSchema == null) console.error('dynamicRef: no schema found, deref() called?', url);
        return yield* errors(value, schema[refKey]);
    },
    *$dynamicRef(url, value, schema) {
        const dynSchema = currentSchema.walk(url, {dynamic:true});
        const subSchema = dynSchema || schema[refKey];
        if (subSchema == null) console.error('dynamicRef: no schema found, deref() called?', url, currentSchema);
        return yield* errors(value, subSchema);
    },
    enum(allowed, value){
        for (const a of allowed) if (deepEqual(a, value)) return true;
    },
    const(constant, value){
        return deepEqual(value, constant);
    },
    type(type, value){
        if (Array.isArray(type)) {
            for (const t of type) if (validators.type(t, value)) return true;
            return;
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
    multipleOf(mOf, value){
        if (Number.isInteger(value) && Number.isInteger(1 / mOf)) return true;
        if (Number.isInteger(value / mOf)) return true;
    },
    minimum: (min,value) => value >= min,
    maximum: (max, value) => value <= max,
    exclusiveMinimum: (min, value) => value > min,
    exclusiveMaximum: (max, value) => value < max,

    // string
    minLength: (minLen, value) => [...value].length >= minLen,
    maxLength: (maxLen, value) => [...value].length <= maxLen,
    pattern: (pattern, value) => new RegExp(pattern,'u').test(value),
    format(format, value){
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
            default: console.warn('json schema unknown format: '+format);
        }
        return true;
    },
    // contentEncoding() {},
    // contentMediaType () {},
    // contentSchema () {},

    // combinators
    *allOf(allOf, value) {
        for (const subSchema of allOf) yield* errors(value, subSchema);
    },
    anyOf(anyOf, value) {
        const collecting = unevaluatedPropertiesFor.has(value);
        let any = false;
        for (const subSchema of anyOf) {
            const ok = errors(value, subSchema).next().done; // is it intentional to stop evaluating on first match?
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
            pass += errors(value, subSchema).next().done ? 1 : 0; // is it intentional to stop evaluating on first match?
            if (pass > 1) return false;
        }
        return pass === 1;
    },
    not(subSchema, value) {
        stopCollectingEvaluated = true;
        const ok = errors(value, subSchema).next().done;
        stopCollectingEvaluated = false;
        return !ok;
    },
    *if(ifSchema, value, schema) {
        if (errors(value, ifSchema).next().done) {
            if (schema.then != null) yield* errors(value, schema.then);
        } else {
            if (schema.else != null) yield* errors(value, schema.else);
        }
    },
};

/* format validation functions */
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
}

/* helpers */
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
async function promisesAllMap(promises) {
    const array = await Promise.all(promises.values());
    const result = new Map();
    for (const [key] of promises) {
        result.set(key, array.shift());
    }
    return result;
}
function uniqueValueIgnoreKeyOrder(value) { // makes the value unique, objects and arrays are stringified
    if (value == null || typeof value !== 'object') return value;
    const copy = deepCopyObjectAndOrderKeys(value);
    return 'hopeNoOneWillEverUseString'+JSON.stringify(copy);
}
function deepCopyObjectAndOrderKeys(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(deepCopyObjectAndOrderKeys);
    const copy = {};
    for (const key of Object.keys(value).sort()) {
        copy[key] = deepCopyObjectAndOrderKeys(value[key]);
    }
    return copy;
}
const GeneratorFunction = (function*(){}).constructor;

// encoding not needed?
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
