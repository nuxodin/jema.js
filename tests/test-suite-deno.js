import {Schema} from '../schema.js';

import { assertEquals } from "https://deno.land/std@0.181.0/testing/asserts.ts";

import {tests} from './test-suite-init.js';

for (const [file, data] of Object.entries(tests)) {


    for (const test of data) {

        const schema = new Schema(test.schema);

        Deno.test(test.description, async () => {
            //console.log('------------------------ file: '+file+'------------------------');

            try {
                await schema.deref();
            } catch (e) {
                // console.log('deref error ', file,  '------------------------');
                // console.log('file ', file);
                // console.log('schema', schema.schema);
            }


            for (const subtest of test.tests) {

                ///console.log(subtest.description);

                const errors = [...schema.errors(subtest.data)];
                const result = errors.length === 0;
                assertEquals(result, subtest.valid);

                // it(subtest.description, () => {

                //     console.log('------------------------', file, '------------------------');
                //     console.log(subtest.description);

                //     const errors = [...schema.errors(subtest.data)];
                //     const result = errors.length === 0;

                //     if (result !== subtest.valid) {
                //         console.log('------------------------error------------------------');
                //         console.log(subtest.description);
                //         console.log('data:', subtest.data);
                //         console.log('schema:', schema.schema);
                //         console.log('expected:', subtest.valid);
                //         console.log('errors', errors);
                //     }
                //     chai.expect( result ).to.be.equal(subtest.valid);
                // });
            }
        });

    }
}
