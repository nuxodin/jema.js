export function toTablesSQL(schema) {
    let sql = '';
    for (const [name, table] of Object.entries(schema.properties)) {

        // primary keys
        const primaries = [];
        Object.entries(table.properties).forEach(([name, field]) => {
            field.x_primary && primaries.push(name);
        });

        sql +=
        'CREATE TABLE `'+name+'` (\n'+
            toFieldsSQL(table)+
            (primaries.length ? 'PRIMARY KEY (`'+primaries.join('`,`')+'`)\n' : '')+
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n';
    }
    return sql;
}
function toFieldsSQL(schema) {
    let sql = '';
    for (const [name, field] of Object.entries(schema.properties)) {
        sql += '`'+name+'` '+toFieldDefinition(field)+',\n';
    }
    return sql;
}
function toFieldDefinition(schema) {
    // produces somethin like the following from a jsonschema
    // eg. "INT(11) NOT NULL DEFAULT '0'";
    // or "VARCHAR(255) NOT NULL DEFAULT '' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'A comment'"
    let sql = '';
    let type = mapType[schema.type];
    let unsigned = false;

    // let realLength = schema.maxLength * 4; // todo, depends on encoding

    if (schema.type === 'integer') {
        const minimum = schema.minimum || -Infinity;
        const maximum = schema.maximum || Infinity;
        if (minimum >= -32768 && maximum <= 32767) type = 'smallint';
        if (minimum >= -8388608 && maximum <= 8388607) type = 'mediumint';
        if (minimum >= -2147483648 && maximum <= 2147483647) type = 'int';
        if (minimum >= -9223372036854775808 && maximum <= 9223372036854775807) type = 'bigint';
        if (minimum >= 0) {
            unsigned = true;
            if (maximum <= 255) type = 'tinyint';
            if (maximum <= 65535) type = 'smallint';
            if (maximum <= 16777215) type = 'mediumint';
            if (maximum <= 4294967295) type = 'int';
            if (maximum <= 18446744073709551615) type = 'bigint';
        }
    }
    if (schema.type === 'string') {
        const maxLength = (schema.maxLength || 4294967295) / 4; // utf8mb4

        if (maxLength <= 255) type = 'varchar';
        else if (maxLength <= 65535) type = 'text';
        else if (maxLength <= 16777215) type = 'mediumtext';
        else if (maxLength <= 4294967295) type = 'longtext';
        else throw new Error('Unexpected string length: ' + maxLength);

        if (schema.format === 'date') type = 'date';
        if (schema.format === 'time') type = 'time';
        if (schema.format === 'date-time') type = 'datetime';
    }

    sql += type.toUpperCase();
    if (unsigned) sql += ' UNSIGNED';
    if (schema.maxLength) sql += '('+schema.maxLength+')'; // TODO: *4 for utf8mb4
    if (schema.required) sql += ' NOT NULL';
    if (schema.default) sql += ' DEFAULT '+schema.default;

    if (schema.contentEncoding === '7bit') sql += ' CHARACTER SET ascii';
    if (schema.contentEncoding === '8bit') sql += ' CHARACTER SET ascii';

    //if (schema.x_collate) sql += ' COLLATE '+schema.x_collate;
    if (schema.title) sql += ' COMMENT "'+schema.title+'"';

    return sql;
}

const mapType = {
    'integer':'int',
    'string':'text',
    'boolean':'tinyint',
    'number':'float',
    'array':'json',
    'object':'json',
}



/*

// from DB to schema

const indexTranslate = {
    PRI: 'primariy',
    UNI: 'unique',
    MUL: true,
}
const typeTranslate = {
    'tinyint':'int8',
    'smallint':'int16',
    'int':'int32',
    'bigint':'int64',
    'varchar':'string',
    'text':'string',
    'tinytext':'string',
}
export async function schemaFromDb(db) {
    var all = await db.query("SELECT * FROM information_schema.`TABLES` WHERE TABLE_SCHEMA = '"+db.conn.config.db+"' ");
    let schema = {
        properties:{},
        name:db.conn.config.db,
    };
    for (let dbTable of all) {
        let tableSchema = schema.properties[dbTable.TABLE_NAME] = {};
        tableSchema.properties = {};
        tableSchema.name = dbTable.TABLE_NAME;
        tableSchema.defaults = {
            charset: dbTable.TABLE_COLLATION.replace(/_.+/,''),
        };

        let fields = await db.query("SELECT * FROM information_schema.COLUMNS WHERE table_schema = '"+db.conn.config.db+"' AND table_name = '"+dbTable.TABLE_NAME+"' ORDER BY ORDINAL_POSITION");
        tableSchema.properties = {};
        for (let dbField of fields) {
            tableSchema.properties[dbField.COLUMN_NAME] = information_schema_columns_entry_to_schema(dbField);
        }
    }
    return schema;
}

function information_schema_columns_entry_to_schema(dbField) {
    let unsigned = dbField.COLUMN_TYPE.match(/ unsigned/,'') ? 'u':'';
    let type = unsigned+typeTranslate[ dbField.DATA_TYPE ];
    type = type[0].toUpperCase() + type.slice(1);
    let length = parseInt(dbField.CHARACTER_MAXIMUM_LENGTH);
    return {
        name:     dbField.COLUMN_NAME,
        type,
        length,
        required: dbField.IS_NULLABLE === 'NO' ? true: false,
        index:    indexTranslate[dbField.COLUMN_KEY],
        default:  dbField.COLUMN_DEFAULT,
        extra:    dbField.EXTRA,
        charset:  dbField.CHARACTER_SET_NAME,
    }
}
*/