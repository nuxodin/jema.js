

// alpha version

export function toHtml(schema, value) {
    const attr = {};
    attr.type = mapTypes[schema.type] ?? 'text';
    if (schema.format) attr.type = mapFormats[schema.format] ?? attr.type;

    if (schema.type === 'integer') attr.step = '1';
    if (schema.readOnly) attr.readonly = true;
    if (schema.writeOnly) attr.readonly = true;
    if (schema.required) attr.required = true;
    if ('maxLength' in schema) attr.maxlength = schema.maxLength;
    if ('minLength' in schema) attr.minlength = schema.minLength;
    if ('pattern' in schema) attr.pattern = schema.pattern;
    if ('maximum' in schema) attr.max = schema.maximum;
    if ('minimum' in schema) attr.min = schema.minimum;
    if ('multipleOf' in schema) attr.step = schema.multipleOf;
    //if ('enum' in schema) attr.list = 'enum';

    attr.placeholder = schema.default ?? schema.example ?? '';
    attr.value = value ?? schema.default ?? '';

    return `<input ${Object.entries(attr).map(([k, v]) => `${k}="${v}"`).join(' ')}>`;
}


const mapTypes = {
    string: 'text',
    number: 'number',
    integer: 'number',
    boolean: 'checkbox',
};

const mapFormats = {
    date: 'date',
    time: 'time',
    date_time: 'datetime-local',
    email: 'email',
    uri: 'url',
};
