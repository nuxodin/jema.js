// how refs collisions handled?
// i found this info:
// https://json-schema.org/draft/2020-12/json-schema-core.html#section-7.7.1.1

const refKey = Symbol('ref');
const defaultLocation = window?.location?.href || 'http://localhost/'; // OK? TODO?
let currentSchema = null;

let schemaStack = null;
let dataStack = null;

// AllSchemas is a global map of all loaded schemas
export const AllSchemas = new Map();
function loadSchema(url) {
    if (!AllSchemas.has(url)) {
        const promise = fetch(url).then(res => res.json()).then(async data => {
            if (data.$id && data.$id !== url) console.warn('Schema id does not match url', data.$id, url);
            data.$id = url;

            const schema = new Schema(data);
            await schema.deref();
            return schema;
        });
        AllSchemas.set(url, promise);
    }
    return AllSchemas.get(url);
}


export class Schema {

    /**
     * Creates a new Schema instance.
     * @param {object|boolean} schema - The JSON schema object.
     */
    constructor(schema){
        if (typeof schema ==='object') schema.$schema ??= 'https://json-schema.org/draft/2020-12/schema';
        this.schema = schema;
        this.id = schema.$id;
        this.anchors = new Map([['', this.schema]]); // including itself as "#"
        this.dynAnchors = new Map();
        this.#findAnchors(this.schema);
    }

    /**
     * Checks the schema for errors. (against the defined meta $schema)
     * @returns {Promise<Array>} A promise that resolves to an array of errors.
     */
    async schemaErrors() {
        const meta = await loadSchema(this.schema.$schema);
        return meta.errors(this.schema);
    }

    /**
     * Validates the value against the schema.
     * @param {*} value - The value to validate.
     * @returns {boolean} True if the value is valid, false otherwise.
     */
    validate(value) {
        return this.errors(value).next().done; // if first "done" is true, no errors
    }

    /**
     * Yields errors for the given value.
     * @param {*} value - The value to check for errors.
     * @returns {Generator} A generator that yields errors.
     */
    *errors (value){
        currentSchema = this;
        this.schemaStack = schemaStack = [];
        this.dataStack = dataStack = [];
        return yield* errors(value, this.schema);
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

    #loadRefs(schema, basis) {
        if (schema.$id) basis = schema.$id;
        const refs = new Map();
        if (schema.$ref && !schema[refKey]) {
            if (schema.$ref[0] !== '#') {
                const url = new URL(schema.$ref, basis).href.split('#')[0];
                refs.set(url, loadSchema(url));
            }
        }
        for (const sub of subSchemas(schema)) {
            this.#loadRefs(sub, basis).forEach((value, key) => refs.set(key, value));
        }
        return refs;
    }

    walk(ref, options) {
        if (ref[0] !== '#') { // walk an other schema
            const {url, hash} = this.relativeUrl(ref);
            const foraignSchema = this.foraignSchemas.get(url);
            if (!foraignSchema) {
                console.warn('foraignSchema not found', url, ref);
                return undefined;
            }
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
        const has = vocabulary[prop]?.subSchema;
        if (has === 'object') for (const sub of Object.values(value)) yield sub;
        if (has === 'array') for (const sub of value) yield sub;
        if (has === true) yield value;
    }
}



const evaluatedFor = new WeakMap();
let stopCollectingEvaluated = false; // for inside "not"

function *errors (value, schema){
    if (schema === false) { yield schemaError(value, false, 'fails, false-schema at:'); return; }
    if (schema === true) return;

    const type = getType(value);

    const unevaluatedName = unevaluatedNames[type];

    if (unevaluatedName in schema) {
        if (!evaluatedFor.has(value)) evaluatedFor.set(value, new Set());
    }

    for (const prop of Object.keys(schema)) {
        const vocal = vocabulary[prop];
        if (!vocal || (vocal.affects && vocal.affects !== type)) continue;
        const validator = vocal?.valid;
        if (!validator) continue;

        schemaStack.push(prop);

        if (validator instanceof GeneratorFunction) {
            yield* validator(schema[prop], value, schema);
        } else {
            if (!validator(schema[prop], value, schema)) {
                yield schemaError(value, schema[prop]);
            }
        }
        schemaStack.pop();
    }
    if (typeValidators[type]) yield* typeValidators[type](schema, value);

    if (unevaluatedName in schema) {
        const evaluated = evaluatedFor.get(value);
        if (evaluated) {
            const keys = type === 'object' ? Object.keys(value) : value.keys();
            for (const key of keys) {
                if (evaluated.has(key)) continue;
                yield* errors(value[key], schema[unevaluatedName]);
            }
            evaluatedFor.delete(value);
        }
    }

}

const typeValidators = {
    *object(schema, value) {

        const properties = schema.properties;
        const patternProperties = schema.patternProperties && Object.entries(schema.patternProperties);
        const additionalProperties = schema.additionalProperties;

        for (const [prop, item] of Object.entries(value)) {

            dataStack.push(prop);

            let additional = true;

            const propSchema = properties?.[prop];
            if (propSchema != null) {

                schemaStack.push('properties', prop);

                yield* errors(item, propSchema);

                schemaStack.pop();
                schemaStack.pop();

                additional = false;
            }
            if (patternProperties) {

                schemaStack.push('patternProperties', prop);

                for (const [pattern, sub] of patternProperties) {
                    if (new RegExp(pattern,'u').test(prop)) {
                        yield* errors(item, sub);
                        additional = false;
                    }
                }

                schemaStack.pop();
                schemaStack.pop();

            }
            if (additionalProperties != null && additional) {

                schemaStack.push('additionalProperties');

                yield* errors(item, additionalProperties);

                schemaStack.pop();

                additional = false;
            }
            if (!additional && !stopCollectingEvaluated) {
                evaluatedFor.get(value)?.add(prop);
            }

            dataStack.pop();

        }

    },
    *array(schema, value) {

        let numContains = 0;

        for (const [i, item] of value.entries()) {

            dataStack.push(i);

            let additional = true;

            if (schema.prefixItems?.[i] != null) {
                yield* errors(item, schema.prefixItems[i]);
                additional = false;
            } else {
                if (schema.items != null) {

                    for (const error of errors(item, schema.items)) {
                        evaluatedFor.get(value)?.clear(); // if items fail, all items are unevaluated, seams a hacky solution
                        yield error;
                    }
                    // yield* errors(item, schema.items);
                    // evaluatedFor.get(value)?.clear();
                    additional = false;
                }
            }

            if (schema.contains != null) {
                const match = errors(item, schema.contains).next().done;
                if (match) {
                    numContains++;
                    additional = false;
                }
            }

            if (!additional) {
                if (!stopCollectingEvaluated) {
                    evaluatedFor.get(value)?.add(i);
                }
            }

            dataStack.pop();
        }

        if (schema.contains != null) {
            const minContains = schema.minContains ?? 1;
            const maxContains = schema.maxContains ?? Infinity;
            if (numContains < minContains) yield 'Array contains too few items that match "contains"';
            if (numContains > maxContains) yield 'Array contains too many items that match "contains"';
        }
    },

}

const vocabulary = {
    $schema: {},
    $vocabulary: {},
    $id: {},
    $anchor: {},
    $dynamicAnchor: {},
    $ref: {
        *valid(url, value, schema) {
            const refSchema = schema[refKey];
            if (refSchema == null) console.error('dynamicRef: no schema found, deref() called?', url);
            return yield* errors(value, schema[refKey]);
        }
    },
    $dynamicRef: {
        *valid(url, value, schema) {
            const dynSchema = currentSchema.walk(url, {dynamic:true});
            const subSchema = dynSchema || schema[refKey];
            if (subSchema == null) console.error('dynamicRef: no schema found, deref() called?', url, currentSchema);
            return yield* errors(value, subSchema);
        }
    },
    // $comment: {},

    $defs: {
        subSchema: 'object',
    },


    // combinators
    allOf: {
        *valid(allOf, value) {
            for (const [i, sub] of allOf.entries()) {
                schemaStack.push(i);
                yield* errors(value, sub);
                schemaStack.pop();
            }
        },
        subSchema: 'array',
    },
    anyOf: {
        valid(anyOf, value) {
            const collecting = evaluatedFor.has(value);
            let any = false;
            for (const sub of anyOf) {
                const ok = errors(value, sub).next().done; // is it intentional to stop evaluating on first match?
                if (ok) {
                    if (!collecting) return true;
                    any = true;
                }
            }
            return any;
        },
        subSchema: 'array',
    },
    oneOf: {
        valid(oneOf, value) {
            let pass = 0;
            for (const subSchema of oneOf) {
                pass += errors(value, subSchema).next().done ? 1 : 0; // is it intentional to stop evaluating on first match?
                if (pass > 1) return false;
            }
            return pass === 1;
        },
        subSchema: 'array',
    },
    not: {
        valid(subSchema, value) {
            stopCollectingEvaluated = true;
            const ok = errors(value, subSchema).next().done;
            schemaStack.pop();
            stopCollectingEvaluated = false;
            return !ok;
        },
        subSchema: true,
    },
    if: {
        *valid(ifSchema, value, schema) {
            const ok = errors(value, ifSchema).next().done;
            schemaStack.pop();
            if (ok) {
                schemaStack.push('then');
                if (schema.then != null) yield* errors(value, schema.then);
            } else {
                schemaStack.push('else');
                if (schema.else != null) yield* errors(value, schema.else);
            }
            schemaStack.pop();
        },
        subSchema: true,
    },
    then: {
        subSchema: true,
    },
    else: {
        subSchema: true,
    },


    // vocabulary
    type: {
        valid(type, value) {
            if (Array.isArray(type)) {
                for (const t of type) if (vocabulary.type.valid(t, value)) return true;
                return;
            }
            const isType = getType(value);
            if (isType === type) return true;
            if (type === 'integer' && isType === 'number' && Number.isInteger(value)) return true;
        }
    },
    enum: {
        valid(allowed, value) {
            for (const a of allowed) if (deepEqual(a, value)) return true;
        }
    },
    const: {
        valid(constant, value) {
            return deepEqual(constant, value);
        }
    },
    multipleOf: {
        valid(mOf, value) {
            const q = value / mOf
            return Number.isFinite(q) && q * mOf === Math.round(q) * mOf
        },
        affects:'number'
    },
    maximum: {
        valid: (max, value) => value <= max,
        affects:'number'
    },
    exclusiveMaximum: {
        valid: (max, value) => value < max,
        affects:'number'
    },
    minimum: {
        valid: (min, value) => value >= min,
        affects:'number'
    },
    exclusiveMinimum: {
        valid: (min, value) => value > min,
        affects:'number'
    },
    maxLength: {
        valid: (max, value) => [...value].length <= max,
        affects:'string'
    },
    minLength: {
        valid: (min, value) => [...value].length >= min,
        affects:'string'
    },
    pattern: {
        valid: (pattern, value) => new RegExp(pattern,'u').test(value),
        affects:'string'
    },
    format: {
        valid: (format, value) => {
return true;
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
            }
            console.warn('json schema unknown format: '+format);
            return true;
        },
        affects:'string'
    },
    maxItems: {
        valid: (max, value) => value.length <= max,
        affects:'array'
    },
    minItems: {
        valid: (min, value) => value.length >= min,
        affects:'array'
    },
    // contentEncoding() {},
    // contentMediaType () {},
    // contentSchema () {},

    // array
    uniqueItems: {
        valid: (unique, value) => {
            if (!unique) return true;
            const seen = new Set();
            for (const item of value) {
                const uniqueValue = uniqueValueIgnoreKeyOrder(item);
                if (seen.has(uniqueValue)) return false;
                seen.add(uniqueValue);
            }
            return true;
        },
        affects:'array'
    },
    items: {
        subSchema: true,
    },
    additionalItems: {
        subSchema: true,
    },
    contains: {
        subSchema: true,
    },
    prefixItems: {
        subSchema: 'array',
    },
    unevaluatedItems: {
        subSchema: true,
    },
    // object
    properties: {
        subSchema: 'object',
    },
    additionalProperties: {
        subSchema: true,
    },
    unevaluatedProperties: {
        subSchema: true,
    },
    patternProperties: {
        subSchema: true,
    },
    maxProperties: {
        valid: (max, value) => Object.keys(value).length <= max,
        affects:'object'
    },
    minProperties: {
        valid: (min, value) => Object.keys(value).length >= min,
        affects:'object'
    },
    required: {
        *valid(required, value) {
            for (const [i, prop] of required.entries()) {
                if (!Object.hasOwn(value, prop)) {
                    schemaStack.push(i);
                    yield schemaError(value, prop, 'missing required property');
                    //yield "missing required property: "+prop;
                    schemaStack.pop();
                }
            }
        },
        affects:'object',
        subSchema: true
    },
    dependentRequired: {
        valid: (dependentRequired, value) => {
            for (const [prop, required] of Object.entries(dependentRequired)) {
                if (Object.hasOwn(value, prop)) {
                    for (const req of required) {
                        if (!Object.hasOwn(value, req)) return false;
                    }
                }
            }
            return true;
        },
        affects:'object'
    },
    dependentSchemas: {
        *valid(dependentSchemas, value) {
            for (const [prop, subSchema] of Object.entries(dependentSchemas)) {
                if (Object.hasOwn(value, prop)) {
                    yield* errors(value, subSchema);
                }
            }
        },
        affects:'object',
        subSchema: true
    },
    dependencies: {
        *valid(dependencies, value) {
            for (const [prop, dep] of Object.entries(dependencies)) {
                if (Object.hasOwn(value, prop)) {
                    if (Array.isArray(dep)) {
                        for (const req of dep) {
                            if (!Object.hasOwn(value, req)) {
                                yield schemaError(value, req, 'missing required property');
                            }
                        }
                    } else {
                        yield* errors(value, dep);
                    }
                }
            }
        }
    },
    propertyNames: {
        *valid(propertyNames, value) {
            for (const prop of Object.keys(value)) {
                yield* errors(prop, propertyNames);
            }
        },
        affects:'object',
        subSchema: true
    },

    // title {},
    // description {},
    // default{},
    // readOnly{},
    // deprecated(deprecated, value, schema) {
    //     if (deprecated) console.error("deprecated (value: " + value + "))", schema);
    //     return true;
    // },
    // writeOnly{},
    // examples{},
}

function schemaError(value, schemaValue, message='does not match'){
    const printValue = Array.isArray(value) ? 'array' : (typeof value === 'object') ? 'object' : '"'+value+'"';
    return {
        message: `${printValue} ${message} ${schemaStack.at(-1)}:${schemaValue}`,
        value,
        schemaValue,
        schemaStack: [...schemaStack],
        dataStack: [...dataStack],
    }
}


function getType(value){
    if (value == null) return 'null';
    const type = typeof value;
    if (type === 'number' && !isFinite(value)) return 'not supported';
    if (type === 'object' && Array.isArray(value)) return 'array';
    return type;
}

const unevaluatedNames = {
    object:'unevaluatedProperties',
    array:'unevaluatedItems',
}


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
    try { new URL('http://' + hostname); } catch { return false; }
    for (let label of hostname.split('.')) {
        label = label.toLowerCase();

        if (label.length > 63) return false;
        if (label.substring(2, 4) === '--') return false;
        if (label.startsWith('-') || label.endsWith('-')) return false;
        // Hebrew GERSHAYIM not preceded by anything
        if (label.match(/(?<!.)\u05F4/)) return false;
        // Hebrew GERESH not preceded by Hebrew
        if (label.match(/(?<![\p{Script=Hebrew}])\u05F3/u)) return false;
        // Greek KERAIA not followed by Greek
        if (label.match(/\u0375(?![\p{Script=Greek}])/u)) return false;
        // Hangul Tone Mark
        if (label.includes('\u302E')) return false;
        // Japanese middle dot and Interpunct (middle dot) only allowed when other Hiragana, Katakana or Han characters are present
        if (label.includes('・') || label.includes('·')) {
            if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(label)) {
                return false;
            }
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

        if (!(part in subSchema)) {
            console.warn(`path '${parts.join('/')}' not found in schema`, schema);
            return undefined; // oder wirf einen Fehler
        }
        
        subSchema = subSchema[part];

        // if (subSchema == null) { zzz
        //     const msg = 'path "' + parts.join('/') + '" not found in schema (at part "' + part + '")';
        //     console.warn(msg, schema);
        // }
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
