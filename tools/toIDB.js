
// alpha

export function upgrade(db, schema) {

    for (const [name, table] of Object.entries(schema.properties)) {
        const primaries = [];
        const indexes = [];
        for (const [name, field] of Object.entries(table.properties)) {
            if (field.x_primary) primaries.push(name);
            if (field.x_index) indexes.push(name);
        }

        let store = null;
        if (!db.objectStoreNames.contains(name)) {
            store = db.createObjectStore(name, {
                keyPath: primaries,
                autoIncrement: false,
            });
        } else {
            store = db.transaction.objectStore(name); // TODO: check if this is correct
        }

        for (const index of indexes) {
            store.createIndex(index, index);
        }
    }
}
