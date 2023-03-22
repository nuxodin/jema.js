
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
    let sql = '';
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

    sql += type.toUpperCase();
    if (unsigned) sql += ' UNSIGNED';
    if (schema.maxLength) sql += '('+(schema.maxLength*4)+')'; // TODO: *4 for utf8mb4
    if (schema.required) sql += ' NOT NULL';
    if (schema.x_autoincrement) sql += ' AUTO_INCREMENT';
    if (schema.default) sql += ' DEFAULT '+schema.default;

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
/*
*/


/*
// how its done in php:

$data['type']          = $data['type']          ?? 'varchar';
$data['length']        = $data['length']        ?? false;
$data['special']       = $data['special']       ?? '';
$data['collate']       = $data['collate']       ?? false;
$data['null']          = $data['null']          ?? false;
$data['autoincrement'] = $data['autoincrement'] ?? false;
$data['default']       = $data['default']       ?? false;

$data['type']    = trim(strtoupper($data['type']));
$data['special'] = trim(strtoupper($data['special']));

$vs = ['VARCHAR','TINYINT','TEXT','DATE','SMALLINT','MEDIUMINT','INT','BIGINT','FLOAT','DOUBLE','DECIMAL','DATETIME','TIMESTAMP','TIME','YEAR','CHAR','TINYBLOB','TINYTEXT','BLOB','MEDIUMBLOB','MEDIUMTEXT','LONGBLOB','LONGTEXT','BOOL','BINARY'];
if (array_search($data['type'], $vs) === false) throw new \Exception('field type "'.$data['type'].'" not allowed');

$vs = ['','BINARY','UNSIGNED','UNSIGNED ZEROFILL','ON UPDATE CURRENT_TIMESTAMP'];
if (array_search($data['special'], $vs) === false) throw new \Exception('field special "'.$data['special'].'" not allowed');

$length = $data['length'] ? '('.$data['length'].')' : '';

if (in_array($data['type'], ['DATE','DATETIME','FLOAT','TEXT','TINYTEXT','MEDIUMTEXT','LONGTEXT'])) $length = '';
if ($data['type'] === 'VARCHAR' && !$length)             $length = '(191)';
if ($data['type'] === 'DECIMAL' && $data['length'] > 65) $length = '(12,8)';

//$default = $data['autoincrement'] ? 'AUTO_INCREMENT' : ($data['default'] ? "DEFAULT ".D()->quote($data['default']) : ""); // todo: bad: D() is used

$default = '';
$defaultKeys = ['NULL'=>1, 'CURRENT_TIMESTAMP'=>1, 'CURRENT_TIMESTAMP()'=>1, 'NOW()'=>1, 'LOCALTIME'=>1, 'LOCALTIME()'=>1, 'LOCALTIMESTAMP'=>1, 'LOCALTIMESTAMP()'=>1];
if ($data['autoincrement']) {
    $default = 'AUTO_INCREMENT';
} elseif($data['default'] !== false) {
    $default = "DEFAULT ".(isset($defaultKeys[$data['default']]) ? $data['default'] : D()->quote($data['default'])); // todo: bad: D() is used
}

if (dbField::$numTypes[$data['type']]??0) $data['collate'] = false;
if (dbField::$dateTypes[$data['type']]??0) $data['collate'] = false;
$collate = '';
if ($data['collate']) {
    $characterSet = explode('_',$data['collate'])[0];
    $collate = "CHARACTER SET ".$characterSet." COLLATE ".$data['collate']." "; // todo: bad: D() is used
}

// ALTER TABLE `file` CHANGE `text` `text` VARCHAR(22222) CHARACTER SET swe7 COLLATE swe7_swedish_ci NULL DEFAULT 'x';
$str = " ".$data['type'].$length." ".$data['special']." ".$collate." ".($data['null']?'NULL':'NOT NULL')." ".$default;
return $str;
*/



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