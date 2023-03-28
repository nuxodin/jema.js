# jema.js
JSONSchema validator for deno and the browser

## Features

🚀 Performant  
🕊️ Lightweight (< 4kb brotli)  
🤝 Works in the Browser and deno (and node.js at the moment)
📦 No dependencies  
🆗 JSONSchema draft-2020-12 (only this)  

## Ussage

```javascript
const schema = new Schema({ type: 'number' });
await schema.deref(); // Dereference remote schemas


schema.validate(3) // true
schema.validate('3') // false

schema.error('3') // get first error (stops on first error)
schema.errors('3') // all errors (iterator);
```

## Install

```javascript
import {Schema} from 'https://cdn.jsdelivr.net/gh/nuxodin/jema.js@x.x.x/schema.min.js';
```

## Todo

- Better error messages (with schema path)  
- Fix a few bugs in the test suite: [link](http://gcdn.li/nuxodin/jema.js/tests/test-suite.html)

## About

- MIT License, Copyright (c) 2022 <u1> (like all repositories in this organization) <br>
- Suggestions, ideas, finding bugs and making pull requests make us very happy. ♥
