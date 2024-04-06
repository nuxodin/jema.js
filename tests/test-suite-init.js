let files = [
    'additionalProperties.json',
    'allOf.json',
    'anchor.json',
    'anyOf.json',
    'boolean_schema.json',
    'const.json',
    'contains.json',
    'content.json',
    'default.json',
    'defs.json',
    'dependentRequired.json',
    'dependentSchemas.json',
    'enum.json',
    'exclusiveMaximum.json',
    'exclusiveMinimum.json',
    'format.json',
    'optional/id.json',
    'if-then-else.json',
    'infinite-loop-detection.json',
    'items.json',
    'maxContains.json',
    'maximum.json',
    'maxItems.json',
    'maxLength.json',
    'maxProperties.json',
    'minContains.json',
    'minimum.json',
    'minItems.json',
    'minLength.json',
    'minProperties.json',
    'multipleOf.json',
    'not.json',
    'oneOf.json',
    'pattern.json',
    'patternProperties.json',
    'prefixItems.json',
    'properties.json',
    'propertyNames.json',
    'ref.json',
    'required.json',
    'type.json',
    'unevaluatedItems.json',
    'unevaluatedProperties.json',
    'uniqueItems.json',
    //'unknownKeyword.json',
    //'vocabulary.json',
    'refRemote.json',
    'dynamicRef.json',

    // 'optional/bignum.json',
    // //'optional/cross-draft.json',
    // 'optional/dependencies-compatibility.json',
    // 'optional/ecmascript-regex.json',
    // 'optional/float-overflow.json',
    // 'optional/format-assertion.json',
    // 'optional/no-schema.json',
    // 'optional/non-bmp-regex.json',
    // 'optional/refOfUnknownKeyword.json',

    // 'optional/format/date.json',
    // 'optional/format/date-time.json',
    // 'optional/format/duration.json',
    // 'optional/format/email.json',
    // 'optional/format/hostname.json',
    // 'optional/format/idn-email.json',
    // 'optional/format/idn-hostname.json',
    // 'optional/format/ipv4.json',
    // 'optional/format/ipv6.json',
    // 'optional/format/iri.json',
    // 'optional/format/iri-reference.json',
    // 'optional/format/json-pointer.json',
    // 'optional/format/regex.json',
    // 'optional/format/relative-json-pointer.json',
    // 'optional/format/time.json',
    // 'optional/format/unknown.json',
    // 'optional/format/uri.json',
    // 'optional/format/uri-reference.json',
    // 'optional/format/uri-template.json',
    // 'optional/format/uuid.json',
];

/* *
files = [
    //'dynamicRef.json',
];
/* */


const promises = new Map();

for (const file of files) {
    promises.set(
        file,
        fetch('https://cdn.jsdelivr.net/gh/json-schema-org/JSON-Schema-Test-Suite@main/tests/draft2020-12/' + file).then(response => response.json())
        //fetch('https://cdn.jsdelivr.net/gh/json-schema-org/JSON-Schema-Test-Suite@main/tests/draft-next/' + file).then(response => response.json())
    );
}

const tests = {};
await Promise.all(promises.values()).then( (result) => {
    for (const [index, data] of result.entries()) {
        const file = files[index];

        tests[file] = data;

        for (const test of data) {

            // http://localhost:1234 = https://cdn.jsdelivr.net/gh/nuxodin/JSON-Schema-Test-Suite@2.0.1/remotes/
            const reqursiveRewriteUrls = (schema)=>{
                for (const key in schema) {
                    if (typeof schema[key] === 'object') {
                        reqursiveRewriteUrls(schema[key]);
                    }
                    if (typeof schema[key] === 'string') {
                        //schema[key] = schema[key].replace('http://localhost:1234', 'https://cdn.jsdelivr.net/gh/nuxodin/JSON-Schema-Test-Suite@2.0.1/remotes');
                        schema[key] = schema[key].replace('http://localhost:1234', 'https://cdn.jsdelivr.net/gh/nuxodin/JSON-Schema-Test-Suite@main/remotes');
                    }
                }
            }
            reqursiveRewriteUrls(test.schema);

        }
    }

});

export {tests};