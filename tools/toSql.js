
export function fromShowFields(fields) {
    const schema = {
        type: 'object',
        properties: {},
        required: [],
    };
    for (const field of fields) {
        const name = field.Field;
        const required = field.Null === 'NO';
        const extra = field.Extra;

        const schemaField = {
            type: 'string',
            title: name,
            default: field.Default,
            $comment: field.Comment,
        };
        let [type, length, unsigned] = field.Type.split(/[()]/);
        if (length) length = parseInt(length);
        if (unsigned) unsigned = unsigned.trim() === 'unsigned';

        if (textTypesLength[type]) {
            schemaField.type = 'string';
            schemaField.maxLength = Math.floor(textTypesLength[type] / 4);
        }
        if (type === 'varchar') {
            schemaField.type = 'string';
            schemaField.maxLength = length / 4;
        }
        if (intTypesSize[type]) {
            schemaField.type = 'integer';
            schemaField.minimum = unsigned ? 0 : (-intTypesSize[type] / 2) - .5;
            schemaField.maximum = unsigned ? intTypesSize[type] : (intTypesSize[type] / 2) - .5;
        }
        if (type === 'float') schemaField.type = 'number';
        if (type === 'double') schemaField.type = 'number';

        if (type === 'datetime') schemaField.format = 'date-time';
        if (type === 'date') schemaField.format = 'date';
        if (type === 'time') schemaField.format = 'time';

        if (field.Key === 'PRI') schemaField.x_primary = true;
        if (field.Key === 'UNI') schemaField.x_unique = true;
        if (field.Key === 'MUL') schemaField.x_index = true;

        if (extra === 'auto_increment') schemaField.x_autoincrement = true;

        // strip undefined
        for (const key in schemaField) {
            if (schemaField[key] === undefined) delete schemaField[key];
        }

        schema.properties[name] = schemaField;
        if (required) schema.required.push(name);
    }
    return schema;
}

export function toFieldDefinition(schema) {
    // produces somethin like the following from a jsonschema
    // eg. "INT(11) NOT NULL AUTO_INCREMENT COMMENT 'A comment'"
    // or "VARCHAR(255) NOT NULL DEFAULT '' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'A comment'"

    let type = mapType[schema.type];
    let unsigned = false;

    // let realLength = schema.maxLength * 4; // todo, depends on encoding
    if (schema.x_autoincrement) {
        schema.type ??= 'integer';
        schema.x_primary ??= true;
        schema.x_unique ??= true;
        schema.minimum ??= 0;
        schema.maximum ??= 4294967295;
    }

    if (schema.type === 'boolean') schema.maxLength = 1;

    if (schema.type === 'integer') {
        const minimum = schema.minimum ?? -Infinity;
        const maximum = schema.maximum ?? Infinity;
        if (minimum >= -32768 && maximum <= 32767) type = 'smallint';
        if (minimum >= -8388608 && maximum <= 8388607) type = 'mediumint';
        if (minimum >= -2147483648 && maximum <= 2147483647) type = 'int';
        if (minimum >= -9223372036854775808 && maximum <= 9223372036854775807) type = 'bigint';
        if (minimum >= 0) {
            unsigned = true;
            type = 'tinyint';
            if (maximum > 255) type = 'smallint';
            if (maximum > 65535) type = 'mediumint';
            if (maximum > 16777215) type = 'int';
            if (maximum > 4294967295) type = 'bigint';
            if (maximum > 18446744073709551615) throw new Error('Unexpected integer length: ' + maximum);
        }
    }
    if (schema.type === 'string') {
        const maxLength = (schema.maxLength || 4294967295) / 4; // utf8mb4
        // loop textTypesLength
        type = 'varchar';
        if (maxLength > 255) type = 'text';
        if (maxLength > 65535) type = 'mediumtext';
        if (maxLength > 16777215) type = 'longtext';
        if (maxLength > 4294967295) throw new Error('Unexpected string length: ' + maxLength);

        if (schema.format === 'date') type = 'date';
        if (schema.format === 'time') type = 'time';
        if (schema.format === 'date-time') type = 'datetime';
    }

    let sql = type.toUpperCase();
    if (unsigned) sql += ' UNSIGNED';
    if (schema.maxLength) sql += '('+(schema.maxLength*4)+')'; // TODO: *4 for utf8mb4
    if (schema.required) sql += ' NOT NULL';
    if (schema.x_autoincrement) sql += ' AUTO_INCREMENT';
    //if (schema.x_primary) sql += ' PRIMARY KEY';

    if (schema.default != null) sql += " DEFAULT '"+quote(schema.default)+"'";

    if (schema.contentEncoding === '7bit') sql += ' CHARACTER SET ascii';
    if (schema.contentEncoding === '8bit') sql += ' CHARACTER SET ascii';

    //if (schema.x_collate) sql += ' COLLATE '+schema.x_collate;

    if (schema.$comment) sql += ' COMMENT "'+schema.title+'"';
    return sql;
}

const mapType = {
    'integer':'int',
    'string':'text',
    'boolean':'tinyint',
    'number':'float',
    'array':'json',
    'object':'json',
};
const textTypesLength = {
    tinytext: 255,
    text: 65535,
    mediumtext: 16777215,
    longtext: 4294967295,
};
const intTypesSize = {
    tinyint: 255,
    smallint: 65535,
    mediumint: 16777215,
    int: 4294967295,
    bigint: 18446744073709551615,
};
function quote(str) {
    return str.replace(/'/g, "''");
}


/* just for test */
export function toCreateTable(schema) {
    let sql = '';
    for (const [name, table] of Object.entries(schema.properties)) {

        // primary keys
        const primaries = [];
        Object.entries(table.properties).forEach(([name, field]) => {
            field.x_primary && primaries.push(name);
            field.x_autoincrement && primaries.push(name);
        });

        sql +=
        'CREATE TABLE `'+name+'` (\n'+
            toFieldsSQL(table)+
            (primaries.length ? '   PRIMARY KEY (`'+primaries.join('`,`')+'`)\n' : '')+
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n';
    }
    return sql;
}
function toFieldsSQL(schema) {
    let sql = '';
    for (const [name, field] of Object.entries(schema.properties)) {
        sql += '  `'+name+'` '+toFieldDefinition(field)+',\n';
    }
    return sql;
}
