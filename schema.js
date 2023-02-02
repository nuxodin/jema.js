//import { mixin } from '../util/js.js';

export class Schema {
    constructor(schema){
        for (const i in schema) this[i] = schema[i];
    }
    validate(value) {
        return !this.error(value);
    }
    transform (value) {
        for (const [prop, descriptor] of Object.entries(properties)) {
            if (!descriptor.transform) continue;
            const propValue = this[prop];
            if (propValue === undefined) continue; // property not set
            const newValue = descriptor.transform(propValue, value);
            if (newValue !== undefined) value = newValue;
        }
        const error = this.error(value);
        if (error) throw Error(error);
        return value;
    }
    *errors (value){
        for (const [prop, descriptor] of Object.entries(properties)) {
            if (!descriptor.validate) continue;
            const propValue = this[prop];
            if (propValue == undefined) continue;
            if (!descriptor.validate(propValue, value)) {
                yield `"${value}" does not match ${prop}:${propValue}`;
            }
        }
    }
    error(value) {
        for (const error of this.errors(value)) return error;
        return false;
    }
}


const properties = {
    title:{},
    description:{},
    default:{
        schemaError: (def, schema) => schema.error(def),
        todo_transform: (def, value) => {
            if (value === null || value) return def;
        },
    },
    examples:{ // useful for autocomplete?
        schemaError: (exampels, schema) => exampels.filter(item => schema.error(item)),
    },
    enum: {
        validate: (allowed, value) => allowed.includes(value),
        schemaError: (allowed, schema) => allowed.filter(item => schema.error(item)),
    },
    type:{
        transform(propValue, value) {
            if (propValue === 'string' && typeof value !== 'string' && value.toString) return value.toString();
            if (propValue === 'number' && typeof value !== 'number') return parseFloat(value);
            if (propValue === 'integer' && !Number.isInteger(value)) return parseInt(value);
            if (propValue === 'boolean' && typeof value !== 'boolean') return !!value;
        },
        validate(propValue, value) {
            console.log(propValue, value);
            if (propValue === 'integer' && Number.isInteger(value)) return true;
            if (propValue === 'number'  && typeof value === 'number' && isFinite(value)) return true;
            if (propValue === 'boolean' && typeof value === 'boolean') return true;
            if (propValue === 'string'  && typeof value === 'string') return true;
            if (propValue === 'array'   && Array.isArray(value)) return true;
            if (propValue === 'object'  && typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
            if (propValue === 'null'    && value == null) return true;
        },
        options: {
            string: {
            },
            number: {
                defaults: {
                    format:'float32',
                }
            },
            integer: {
                defaults: {
                    format:'int32'
                }
            },
            boolean: {},
            object: {},
            array: {},
        }
    },
    min:{
        type:'integer',
        validate: (min, value) => value >= min,
    },
    max:{
        type:'integer',
        validate: (max, value) => value <= max,
    },
    minLength:{
        type:'integer',
        validate: (minLen, value) => value.length >= minLen,
    },
    maxLength:{
        type:'integer',
        validate: (maxLen, value) => value.length <= maxLen,
    },
    multipleOf:{
        type:'number',
        validate: (propValue, value) => value % propValue === 0,
    },
    pattern:{
        validate: (pattern, value) => {
            try { return new RegExp(pattern).test(value); } catch { return true; }
        },
        schemaError: (pattern)=>{
            try { RegExp(pattern).test('test'); } catch (e) { return e.message; }
        }
    },
    format:{
        validate: (format, value) => {
            switch (format) {
                case 'date-time': return !isNaN(Date.parse(value));
                case 'date': return !isNaN(Date.parse(value));
                case 'time': return !isNaN(Date.parse(value));
                case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
                case 'hostname': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
                case 'ipv4': return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
                case 'ipv6': return /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(value);
                case 'uri': return /^https?:\/\/[^\s]+$/.test(value);
                case 'uri-reference': return /^https?:\/\/[^\s]+$/.test(value);
                case 'uri-template': return /^https?:\/\/[^\s]+$/.test(value);
                case 'uuid': return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
                case 'json-pointer': return /^\/[^\s]+$/.test(value);
                case 'relative-json-pointer': return /^\/[^\s]+$/.test(value);
                case 'regex': return /^\/[^\s]+$/.test(value);
            }
        }
    },
}
