# jema.js
JSON Schema validator for ***deno*** and ***browsers***

JSON Schema is the leading standard for validating and describing data. It is platform-independent and simplifies the automation of validation, documentation, and processing of data.

## Features

🚀 Performant  
🕊️ Lightweight (< 4kb brotli)  
🤝 Works in the Browser and deno (no node.js at the moment)  
📦 No dependencies  
🆗 JSONSchema draft-2020-12 (only this)  

## Basic ussage

```javascript
const schema = new Schema({
    type: 'string',
    minLength: 3,
    pattern: '^[a-zA-Z]+$',
});
await schema.deref(); // Dereference remote schemas

schema.validate('Li') // false
schema.validate('Liam') // true
schema.validate('Li-Am') // false
```

## Install

```javascript
import {Schema} from 'https://cdn.jsdelivr.net/gh/nuxodin/jema.js@x.x.x/schema.min.js';
```


## Debugging

```javascript
// errors
const errors = schema.errors('L-')
for (const error of errors) {
    console.log(error.message)
    // "L-" does not match minLength:3
    // "L-" does not match pattern:^[a-zA-Z]+$
}

// schema validation
const schema = new Schema({
    type: 'stringg',
});
await schema.schemaErrors(); 

```	


## Todo

- Better error messages (~~with schema location~~, conforming to the JSON Schema spec)  
- Fix a few bugs in the test suite: [link](http://gcdn.li/nuxodin/jema.js/tests/test-suite.html) mainly
    - "$dynamicRef"
    - "$vocabulary"
    - and some minor "format" errors

If someone wants to help, please do so.

## About

- MIT License, Copyright (c) 2022 <u1> (like all repositories in this organization) <br>
- Suggestions, ideas, finding bugs and making pull requests make us very happy. ♥
