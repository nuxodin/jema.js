
// how refs collisions handled?
// i found this info:
// https://json-schema.org/draft/2020-12/json-schema-core.html#section-7.7.1.1


export class Schema {
    constructor(schema){
        this.schema = schema;
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
        await this.#loadRefs();
        this.#_deref(this.schema);
    }
    #_deref(schema) {
        if (!schema) return;
        for (const [prop, value] of Object.entries(schema)) {
            if (prop === '$ref') {
                let subSchema;
                if (value[0] !== '#') {
                    const url = value.replace(/#.*/, '');
                    const foraignSchema = this.foraignSchemas.get(url).schema;
                    subSchema = walk(foraignSchema, value.replace(/.*#/, ''));
                } else {
                    subSchema = walk(this.schema, value.replace(/.*#/, ''));
                }
                schema.$ref = subSchema;
            } else if (typeof value === 'object') {
                this.#_deref(schema[prop]);
            }
        }
    }
    async #loadRefs(){
        const promises = this.#_loadRefs(this.schema);
        const schemasArray = await Promise.all(promises.values()).catch(console.error);
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
            if (prop === '$ref') {
                if (value[0] !== '#') {
                    const url = value.replace(/#.*/, '');
                    refs.set(url, loadSchema(url));
                }
            } else if (typeof value === 'object') {
                for (const [url, promise] of this.#_loadRefs(schema[prop])) {
                    refs.set(url, promise);
                }
            }
        }
        return refs;
    }
}

export function *errors (value, schema){
    delete schema.$comment; // remove comments to ensure they are not used by the user of the schema

    if (schema === false) {
        yield 'Schema is false';
        return;
    }
    if (schema === true) {
        return;
    }

    let type = typeof value;
    if (value === null) type = 'null';
    if (Array.isArray(value)) type = 'array';

    for (const prop of Object.keys(schema)) {
        const validator = validators[prop];
        if (!validator) {
            if (prop === '$defs') continue; // ignore $def
            if (prop === '$schema') continue; // ignore $def
//            console.log(`Validator "${prop}" not found`);
        } else {

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
    items: ['array'],
    additionalItems: ['array'],
    minItems: ['array'],
    maxItems: ['array'],
    uniqueItems: ['array'],
    contains: ['array'],
    minProperties: ['object'],
    maxProperties: ['object'],
    required: ['object'],
    properties: ['object'],
    patternProperties: ['object'],
    additionalProperties: ['object'],
    //dependencies: ['object'],
    propertyNames: ['object'],
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
    //multipleOf: (mOf, value) => value % mOf === 0,
    multipleOf: (mOf, value) => Number.isInteger(value / mOf),

    minimum: (min, value) => value >= min,
    maximum: (max, value) => value <= max,
    exclusiveMinimum: (min, value) => value > min,
    exclusiveMaximum: (max, value) => value < max,

    // string
    minLength: (minLen, value) => [...value].length >= minLen,
    maxLength: (maxLen, value) => [...value].length <= maxLen,
    pattern: (pattern, value) => {
            try { return new RegExp(pattern).test(value); } catch { return true; }
    },
    format: (format, value) => {
        switch (format) {
            //case 'date-time': return !isNaN(Date.parse(value.toUpperCase()));
            case 'date-time': return validDateTime(value);
            case 'date': return validDate(value);
            case 'time': return validTime(value);
            case 'duration': return /^P(\d+Y|\d+M|\d+D|\d+W|T(\d+H|\d+M|\d+S))+$/.test(value); // TODD: use Temporal when available
            case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
            case 'idn-email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
            case 'hostname': return /^[^\s@]+\.[^\s@]+$/.test(value);
            case 'ipv4': return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
            case 'ipv6': return /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/gi.test(value);
            //case 'uri': return /^https?:\/\/[^\s]+$/.test(value);
            case 'uri':
            case 'iri':
                try {
                    new URL(value);
                    return true;
                } catch { return false; }
            case 'uri-reference':
                try {
                    new URL(value, 'http://x.y');
                    return true;
                } catch { return false; }
            case 'uri-template': return /^([^\{\}]|\{[^\{\}]+\})*$/.test(value);
            case 'idn-hostname': {
                try {
                    const url = new URL('http://'+value);
                    //console.log({value, hostname: url.hostname, equal: url.hostname === value});
                    //return true;
                    //return url.hostname === value;
                    if (url.hostname !== value) return false;
                } catch { return false; }
                return isValidIDN(value);
            }
            case 'iri-reference': return /^https?:\/\/[^\s]+$/.test(value);
            case 'uuid': return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
            case 'json-pointer': return /^\/[^\s]+$/.test(value);
            case 'relative-json-pointer': return /^\/[^\s]+$/.test(value);
            case 'regex': {
                try {
                    new RegExp(value);
                    return true;
                } catch { return false; }
            }
        }
        return true;
    },
    contentEncoding(encoding, value) {
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

    // array
    *items(schema, value) {
        if (schema === false) { // TODO: ok?
            if (value.length > 0) yield "must be empty";
            return;
        }
        for (const item of value) {
            yield* errors(item, schema);
        }
    },
    *prefixItems(prefixItems, value) {
        let i = 0;
        for (const schema of prefixItems) {
            if (value[i] === undefined) return;
            yield* errors(value[i++], schema);
        }
    },
    //additionalItems: (additionalItems, value, schema) => {}, // todo
    *contains(contains, value, schema) {
        const minContains = schema.minContains ?? 0;
        const maxContains = schema.maxContains ?? Infinity;
        let num = 0;
        for (const item of value) {
            if (!errors(item, contains).next().done) continue; // does not match, ignore
            num++;
            if (num >= minContains && maxContains === Infinity) return;
        }
        if (num < minContains) yield "does not contain enough items";
        if (num > maxContains) yield "contains too many items";
    },
    minItems: (minItems, value) => value.length >= minItems,
    maxItems: (maxItems, value) => value.length <= maxItems,
    uniqueItems: (uniqueItems, value) => {
        if (uniqueItems) {
            const set = new Set();
            for (const item of value) {
                const uValue = typeof item === 'object' && item != null ? 'hack'+JSON.stringify(item) : item; // todo: order of keys are not relevant, but JSON.stringify does not sort them
                if (set.has(uValue)) return false;
                set.add(uValue);
            }
        }
        return true;
    },

    // properties
    *properties(properties, value) {
        for (const prop of Object.keys(value)) {
            const propSchema = properties[prop];
            if (propSchema) yield* errors(value[prop], propSchema);
        }
    },
    *patternProperties(patternProperties, value) {
        const patterns = Object.entries(patternProperties);
        for (const prop of Object.keys(value)) {
            for (const [pattern, subSchema] of patterns) {
                if (new RegExp(pattern).test(prop)) {
                    yield* errors(value[prop], subSchema);
                }
            }
        }
    },
    *propertyNames(propertyNames, value) {
        for (const prop of Object.keys(value)) {
            if (propertyNames===false) yield "property name '" + prop + "' is not allowed";
            yield* errors(prop, propertyNames);
        }
    },
    *additionalProperties(additionalProperties, value, schema){
        const schemaProperties = Object.keys(schema.properties??{});
        for (const prop of Object.keys(value)) {
            if (!schemaProperties.includes(prop)) {
                if (additionalProperties === false) {
                    yield "property '" + prop + "' is not allowed";
                } else {
                    yield* errors(value[prop], additionalProperties);
                }
            }
        }
    },
    required: (required, value) => {
        const properties = Object.keys(value);
        for (const prop of required) {
            if (!properties.includes(prop)) return false;
        }
        return true;
    },
    minProperties: (minProperties, value) => {
        return Object.keys(value).length >= minProperties;
    },
    maxProperties: (maxProperties, value) => {
        return Object.keys(value).length <= maxProperties;
    },


    // combiners
    *allOf(allOf, value) {
        for (const subSchema of allOf) {
            yield* errors(value, subSchema);
        }
    },
    anyOf(anyOf, value) {
        for (const subSchema of anyOf) {
            if (errors(value, subSchema).next().done) return true;
        }
        return false;
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
        for (const _error of errors(value, subschema)) {
            return true;
        }
    },
    deprecated(deprecated, value, schema) {
        if (deprecated) console.error("deprecated (value: " + value + "))", schema);
        return true;
    },
    // todo: implement
    // *if(ifSchema, value, schema) {
    //     if (errors(value, ifSchema).next().done) {
    //         yield* errors(value, schema.then);
    //     } else {
    //         yield* errors(value, schema.else);
    //     }
    // },
    // *then(thenSchema, value, schema) {
    //     if (errors(value, schema.if).next().done) {
    //         yield* errors(value, thenSchema);
    //     }
    // },
    // *else(elseSchema, value, schema) {
    //     if (!errors(value, schema.if).next().done) {
    //         yield* errors(value, elseSchema);
    //     }
    // },
    // *dependentRequired(dependentRequired, value) {
    //     for (const prop of Object.keys(value)) {
    //         if (dependentRequired[prop]) {
    //             for (const requiredProp of dependentRequired[prop]) {
    //                 if (!value[requiredProp]) {
    //                     yield "property '" + requiredProp + "' is required";
    //                 }
    //             }
    //         }
    //     }
    // },

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

function walk(schema, path) {
    const parts = path.split('/').filter(Boolean);
    let subSchema = schema;
    for (const part of parts) {
        subSchema = subSchema[part];
        if (!subSchema) {
            const msg = "path "+path+" not found in schema";
            console.warn(msg, schema);
            throw new Error(msg);
        }
    }
    return subSchema;
}
function deepMixin(target, source) {
    for (const [prop, value] of Object.entries(source)) {
        if (typeof value === 'object') {
            if (!target[prop]) target[prop] = {};
            deepMixin(target[prop], value);
        } else {
            target[prop] = value;
        }
    }
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


// const validDateTime = (value) => {
//     const x = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([\+-]\d{2}):(\d{2}))$/i);
//     if (!x) return false;
//     const [year, month, day, hours, minutes, seconds, offsetHours, offsetMinutes] = x.slice(1);
//     if (month > 12) return false;
//     if (day > 28) {
//         const maxDays = new Date(year, month, 0).getDate();
//         if (day > maxDays) return false;
//     }
//     if (hours > 23) return false;
//     if (minutes > 59) return false;
//     if (seconds > 60) return false;
//     if (offsetHours!=null) {
//         if (offsetHours > 23) return false;
//         if (offsetHours < -23) return false;
//         if (offsetMinutes === undefined) return false;
//         if (offsetMinutes > 59) return false;

//     }
//     if (seconds == '60') {
//         const minutesUtf = minutes*1 + -(offsetMinutes || 0);
//         const hoursUtf   = hours*1 + -(offsetHours || 0);
//         console.log({minutesUtf, hoursUtf})
//         // if (minutes != '59') return false;
//         // if (hours != '23') return false;
//         if (minutesUtf !== 59 && minutesUtf !== -1) return false;
//         if (hoursUtf !== 23 && hoursUtf !== 0) return false;
//     }
//     return true;
// }
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



function isValidIDN(hostname) {
    const regex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
    // Check if the input hostname matches the basic DNS hostname pattern
    if (!regex.test(hostname)) return false;
    try {
        // Convert the hostname to its Punycode representation
        const punycodeHostname = encodeURI(hostname)
        .replace(/%[0-9A-F]{2}/g, c => String.fromCharCode('0x' + c.substr(1)))
        .split('.')
        .map(label => {
            return label.match(/^xn--/) ? punycode.decode(label.slice(4)) : label;
        })
        .join('.');
        // Check if the Punycode representation of the hostname is valid
        if (!regex.test(punycodeHostname)) return false;
    } catch {
        return false;
    }
    return true;
}