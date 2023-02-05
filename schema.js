//import { mixin } from '../util/js.js';

export class Schema {
    #schema;
    constructor(schema){
        this.#schema = schema;
    }
    validate(value) {
        return !this.error(value);
    }
    *errors (value){
        return yield* errors(value, this.#schema);
    }
    error(value) {
        for (const error of this.errors(value)) return error;
        return false;
    }
}

function *errors (value, schema){
    delete schema.$comment; // remove comments to ensure they are not used by the user of the schema
    for (const prop of Object.keys(schema)) {
        const validator = validators[prop];
        if (!validator) {
            console.log(`Validator "${prop}" not found`);
        } else {
            if (validator instanceof GeneratorFunction)
                yield* validator(schema[prop], value, schema);
            else {
                const valide = validator(schema[prop], value, schema);
                if (!valide) yield `"${value}" does not match ${prop}:${schema[prop]}`;
            }
        }
    }
}


const GeneratorFunction = (function*(){}).constructor;


const validators = {
    enum: (allowed, value) => allowed.includes(value),
    const: (constant, value) => constant === value,
    type: (type, value) => {
        if (type === 'integer' && Number.isInteger(value)) return true;
        if (type === 'number'  && typeof value === 'number' && isFinite(value)) return true;
        if (type === 'boolean' && typeof value === 'boolean') return true;
        if (type === 'string'  && typeof value === 'string') return true;
        if (type === 'array'   && Array.isArray(value)) return true;
        if (type === 'object'  && typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
        if (type === 'null'    && value == null) return true;
    },
    min: (min, value) => value >= min,
    max: (max, value) => value <= max,
    minLength: (minLen, value) => value.length >= minLen,
    maxLength: (maxLen, value) => value.length <= maxLen,
    multipleOf: (propValue, value) => value % propValue === 0,
    minimum: (min, value) => value >= min,
    maximum: (max, value) => value <= max,
    exclusiveMinimum: (min, value) => value > min,
    exclusiveMaximum: (max, value) => value < max,
    pattern: (pattern, value) => {
            try { return new RegExp(pattern).test(value); } catch { return true; }
    },
    format: (format, value) => {
        switch (format) {
            case 'date-time': return !isNaN(Date.parse(value));
            case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(value);
            case 'time': return /^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
            case 'duration': return /^P(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(value);
            case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
            case 'idn-email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
            case 'hostname': return /^[^\s@]+\.[^\s@]+$/.test(value);
            case 'ipv4': return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
            case 'ipv6': return /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/gi.test(value);
            case 'uri': return /^https?:\/\/[^\s]+$/.test(value);
            case 'uri-reference': return /^https?:\/\/[^\s]+$/.test(value);
            case 'uri-template': return /^https?:\/\/[^\s]+$/.test(value);
            case 'iri': return /^https?:\/\/[^\s]+$/.test(value);
            case 'iri-reference': return /^https?:\/\/[^\s]+$/.test(value);
            case 'uuid': return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
            case 'json-pointer': return /^\/[^\s]+$/.test(value);
            case 'relative-json-pointer': return /^\/[^\s]+$/.test(value);
            case 'regex': return /^\/[^\s]+$/.test(value);
        }
    },
    // array
    *items(schema, value) {
        for (const item of value) {
            yield* errors(item, schema);
        }
    },
    *prefixItems(prefixItems, value) {
        for (const schema of prefixItems) {
            yield* errors(value.shift(), schema);
        }
    },
    *contains(contains, value, schema) {
        const minContains = schema.minContains || 1;
        const maxContains = schema.maxContains || Infinity;
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
                if (set.has(item)) return false;
                set.add(item);
            }
        }
        return true;
    },




    // properties
    *additionalProperties(additionalProperties, value, schema){
        const schemaProperties = Object.keys(schema.properties);
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
    *properties(properties, value) {
        for (const prop of Object.keys(value)) {
            const propSchema = properties[prop];
            if (propSchema) yield* errors(value[prop], propSchema);
        }
        //return true;
    },
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
        let fails = 0;
        for (const subSchema of oneOf) {
            fails += [...errors(value, subSchema)].length ? 1 : 0;
            if (fails > 1) return false;
        }
        return fails === 1;
    },
    not(subschema, value) {
        for (const _error of errors(value, subschema)) {
            return true;
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
            yield* errors(prop, propertyNames);
        }
    },
    deprecated(deprecated, value, schema) {
        if (deprecated) {
            console.warn("deprecated (value: " + value + "))", schema);
        }
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
