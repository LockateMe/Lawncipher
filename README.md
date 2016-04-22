# Lawncipher

__NOTE:__ This library is being adapted to work both in Nodejs and Cordova/Phonegap. It is not yet ready for use.

Lawnchair-inspired libsodium-backed encrypted persistent document storage

## Goal

Building a rather versatile and persistent encrypted document storage.

## Design

* Lawncipher is a document store
* The entirety of Lawncipher data is encrypted using either a password or a 256-bit key. (In case a password is used, it is transformed into a root key using [scrypt](http://www.tarsnap.com/scrypt.html))
* Instead of tables containing rows, Lawncipher has collections containing documents
* A document in Lawncipher has a unique ID and at least one of these two things:
    * A blob : could a JSON object, a string or arbitrary binary data (in a `Uint8Array`). It is stored encrypted and stored in a dedicated file, and decrypted on request.
    * An indexData : An object, containing the query-able attributes of the document, stored in the collection's index.
* When running a query, and the result list is being built, for a given result document, the result list will contain its blob. If the document doesn't have a blob, the indexData will take its place in the result list.
* A schema, called "Index model", can be set for the indexData in a given collection. This schema gives the list and type of attributes that will be stored in the index. It can also determine whether a given attribute gives the IDs to the documents of the collection; as well as whether the value of a given attribute must be unique across the collection (without giving document IDs).
* When inserting a document, if a JSON object is given as blob, the indexData can easily be extracted from the blob.
* A document can be forced to expire, using TTLs (Time-to-live)

## Getting started

### In Node.js

```shell
npm install lawncipher
```

Then, we are good to go:

```js
var Lawncipher = require('lawncipher');
var db = new Lawncipher.db('path/to/my/database');

db.openWithPassword('strongPasswordWow', function(err){
    if (err){
        if (err == 'INVALID_ROOTKEY'){
            //Invalid password
        }
        return;
    }

    //Do things with the database
});
```

### In Cordova

Install the Cordova plugins:
* [cordova-plugin-file-node-like](https://github.com/LockateMe/cordova-plugin-file-node-like)
* [cordova-plugin-scrypt](https://github.com/Crypho/cordova-plugin-scrypt) (Optional, but highly recommended, especially on iOS)

Then install Lawncipher:

```shell
bower install lawncipher
```

Once we have installed Lawncipher (and the plugins mentioned above) and that we have imported Lawncipher into our application:

```js
//Initialize the file system
window.plugins.nodefs.init(function(err){
    if (err){
        console.error('Error while initializing the file system: ' + err);
        return;
    }

    var fs = window.plugins.nodefs(window._fs);

    //If you have installed cordova-plugin-scrypt
    Lawncipher.useCordovaPluginScrypt();

    var db = new Lawncipher.db('path/to/my/db', fs);

    db.openWithPassword('strongPasswordWow', function(err){
        if (err){
            if (err == 'INVALID_ROOTKEY'){
                //Invalid password
            }
            return;
        }

        //Do things with the database
    });
});
```

## Example queries (and their SQL counterpart)

__`Collection.find('abc')`__ : Looking up the document having 'abc' as ID.

__`Collection.find({firstName: 'Steve', lastName: 'Jobs'}, callback)`__
SELECT * FROM tableName WHERE firstName = 'Steve' AND lastName = 'Jobs'

__`Collection.find({firstName: 'Steve', $not: {lastName: 'Jobs'}}, callback)`__ SELECT * FROM tableName WHERE firstName = 'Steve' AND lastName <> 'Jobs'

__`Collection.find({$or: [{firstName: ’Steve}, {lastName: ‘Jobs'}]}, callback)`__
SELECT * FROM tableName WHERE firstName = 'Steve' OR lastName = 'Jobs'  

__`Collection.find({firstName: 'Steve', $or: [{lastName: 'Wozniak'}, {lastName: 'Jobs'}])`__
SELECT * FROM tableName WHERE firstName = 'Steve' AND (lastName = 'Wozniak' OR lastName = 'Jobs')

__`Collection.find({firstName: 'Steve', $sort: {lastName: 'asc'}, $skip: 100}, callback, 100)`__
SELECT * FROM tableName WHERE firstName = 'Steve' ORDER BY lastName ASC LIMIT 100 OFFSET 100 (get the 101-200 guys who are called Steve, ordered alphabetically by lastName)

## API

### `new Lawncipher.db(rootPath, [fs])`
Constructor method
* `String rootPath` : root Lawncipher directory path
* `Object fs` : The filesystem object to be used by the Lawncipher instance. Required when running in Cordova; the instance must come from [cordova-plugin-file-node-like](https://github.com/LockateMe/cordova-plugin-file-node-like)

### `Lawncipher.useCordovaPluginScrypt()`
Call this function to tell Lawncipher to use [cordova-plugin-scrypt](https://github.com/Crypho/cordova-plugin-scrypt) when it needs to derive passwords into encryption keys. To be called only if the scrypt plugin is installed.

### `Lawncipher.setScryptProvider(scryptProvider, useAsynchronously)`
* Function|String scryptProvider. The function that will be used as scrypt provider. The function must have the following interface : (String password, Uint8Array salt, Number opsLimit, Number r, Number p, Number keyLength, [Function callback(err, derivedKey)]). To reset the provider to the default one (using libsodium.js), pass `'default'` or `'reset'` instead of a function.
* Boolean useAsynchronously : to be set as `true` if the scryptProvider is asynchronous and will use the `callback(err, derivedKey)` to pass its result.

### `db.open(rootKey, callback)`
Open the Lawncipher document store, with a root encryption key
* `Uint8Array rootKey` : the Lawncipher root key. Must be 256 bits / 32 bytes long
* `Function callback` : callback function. Receiving only an `err` string, that is defined in case an error occurred while opening the DB. This callback function is invoked when the DB collection list has been loaded

### `db.openWithPassword(password, callback)`
Open the Lawncipher document store, with a user-provided password
* `String password` : the password, that will be derived into a 32 bytes rootKey by scrypt
* `Function callback` : callback function. Receiving only an `err` string, that is defined in case an error occurred while opening the DB. This callback function is invoked when the DB collection list has been loaded

### `db.close()`
Close Lawncipher, if open

### `db.isOpen()`
Returns a boolean, indicating whether Lawncipher is open or not

### `db.collection(name, indexModel, callback)`
Open an existing Lawncipher collection, or creates it if it doesn't exist
* `String name` : the collection's name
* `Object|Array<String> indexModel` : the index model. The attributes that will be extracted and/or saved in the collection's \_index file. The query-able data. If the collection already exists, this parameter will simply be ignored. Optional parameter.
* `Function callback` : callback function, receiving errors or the constructed Collection object (`function(err, collection)`)
* returns the constructed `Collection` object

### `db.collections(callback)`
Getting the names of existing collections
* `Function callback(err, collectionsNames)` : callback function receiving an error or the collectionsNames array of strings
* Returns the collectionsNames array of strings

### `db.dropCollection(collectionName, callback)`
Deleting an existing collection. Note that this operation once invoked cannot be undone.
* `String collectionName` : the name of the collection to be deleted
* `Function callback` : the callback function, receiving `(err)`, a string briefly describing the error, if one occurred

### `Collection.save(blob, index, cb, overwrite, ttl)`
Save a document/blob in the current collection
* `Object|String|Uint8Array blob` : the raw document to be saved as an independent encrypted (un-query-able) file. Optional parameter
* `Object|Array<String> index` : index data. The qurey-able data for the document to be saved. A standard JS object. Can also be an array of strings in case blob is a standard JS object; the array indicates the names of the fields to be extracted from the blob and to be saved in the index
* `Function cb` : callback function. Receiving `(err, docId)`, where `err` is a string briefly describing the error, if one occurred; and `docId` is the Id attributed to the saved document.
* `Boolean overwrite` : a boolean indicating whether this new document can overwrite an other that uses the same ID. Optional parameter.
* `Number|Date ttl` : TTL for the document (in milliseconds) or date of expiry. Optional parameter.

### `Collection.bulkSave(blobs, indices, cb, overwrite, ttls)`
Save a list of documents/blobs in the current collection. Note that when provided as arrays, `blobs`, 'indices' and `ttls` must have the same length. There must be also an index correspondence (ie, blobs[0] and indices[0] and ttls[0] will correspond to the same doc when saved)
* `Array<Object|String|Uint8Array> blobs` : the list of documents to be saved in the collection
* `Array<Object|Array<String>> indices` : the list of query-able index data to be saved in the collection
* `Function cb` : callback function. Receiving `(err, docIDs)`, where `err` is a string or an `Error`-related object, if an error occurred, and `docIDs` is the array of IDs attributed to the documents that have been saved the call (with the same index correspondence).
* `Boolean overwrite` : a boolean telling whether existing docs can be overwritten.
* `Number|Date|Array<Number|Date> ttls` : a TTL value, or an array with TTL values

### `Collection.update(q, newData, callback, indexOnly)`
Update a existing documents (index or blob data)
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Object|String|Uint8Array newData` : the data that will be used to update/replace the matched documents
* `Function callback` : callback function. Receiving `(err, updatedCount)`, where `err` is a string briefly describing the error, if one occured; and updatedCount is the number of documents that have been updated
* `Boolean indexOnly` : if an updated doc has a JSON blob and indexData, this parameter ensures that only the index will be updated with `newData`.

### `Collection.find(q, cb, limit)`
Find documents in the current collection. If a matched document doesn't have blob, its index data is returned.
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function cb(err, docs)` : callback function. Receives the matched docs or the error that occurred
* `Number limit` : The maximum number of documents to be returned. Optional parameter.

### `Collection.findOne(q, cb)`
Find a single document in the current collection, matching the provided query. As in `Collection.find`, if a matched document doesn't have blob, its index data is returned.
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function cb(err, doc)` : callback function. Receives the matched doc or the error that occurred

### `Collection.remove(q, cb)`
Remove from the collection the documents matched by the query q
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function callback(err)` : callback function. Called when the removal of the matched documents is completed, or when an error occurs.

### `Collection.count(q)`
Count the documents in the collection that match the provided query. Can also be used to test the existence of a document
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* Returns the count result (`Number`)

### `Collection.size(cb)`
Get an approximate size (in bytes) of the current collection
* `Function cb(err, size)` : Optional. Result is returned in case no `cb` parameter is passed

### `Collection.setTTL(q, ttl, cb)`
Set/update the TTL with value `ttl` for the documents matched by the query `q`
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Number|Date|Null|Undefined ttl` : Time-to-live for the documents matched by `q`. If it's a number, it will be counted as milliseconds from the current instant. If it's a date, it's used as-is as TTL date for the documents. If ttl == 0 or ttl == null or ttl is undefined, this will remove any TTL for the selected documents.
* `Function cb` : callback function. Receives the error, if one occurred

### `Collection.getTTL(q, cb)`
Get the TTLs of the documents matched by the query `q`. Results is a hash<docId, ttlUtcEpoch>
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function cb` : callback function. Optional. If omitted, the result is returned.

### `Collection.close()`
Close, if open, the current collection

__About compound queries__
It works a bit like in MongoDB:
* If you want a doc/docs that has a `field1` with `value1`, then the compound query should be `{field1: value1}`
* If you want a doc/docs that has/have a `field1` with `value1` and `field2` with `value2`, then the compound query should be `{field1: value1, field2: value2}`
* If you want a doc/docs that either has/have `field1` with `value1` or `field2` with `value2`, then the compound query should be `{$or: [{field1: value1}, {field2: value2}]}`
* If you want a doc/docs that don't have `field1` with `value1`, then the compound query should be `{$not: {field1: value1}}`
* You can sort your results with the `$sort` operator. Works best with Number, Date and String values
    * To sort the results by `field1` in ascending order, add `$sort: {field1: 'asc'}` or `$sort: {field1: 1}` to your compound query
    * To sort the results by `field1` in descending order, add `$sort: {field1: 'desc'}` or `$sort: {field1: -1}` to your compound query
* You can skip/omit results of a query through the `$skip` operator. To skip x results, add a `$skip: x` attribute to your query. Useful (and stable/consistent!) when used in conjunction of `$sort` (and optionally limiting the result set size through the `limit` parameter of the `find()` method)

__About Time-to-live (TTL)__
Lawncipher checks for expired docs every 5 seconds

### Root `_index` file model

```
[
 	{name: 'collection_name', scrypt: {r, p, opsLimit}},
 	...
]
```

### Collection `_index` file model:

```
{
	indexModel: indexModelObjectOrArray,
	documents: {
		"docId": {
			index: {extractedOrProvidedData},
			blobType: 'string|buffer|json'
			k: blob/file encryption key, //Optional. Only if the first `blob` parameter is provided when saving the document
			ttl: Time-to-live for the document. Unixepoch, in seconds. Optional
		},
		...
	}

}
```

### Document model (`indexModel`):

Two versions possible:
* You provide an object describing field to be extracted/provided by the user, to be inserted in the index file of the collection. You can define which field values must be unique and which one will be chosen as docId
* You provide an array of string, where each string is a field name. Each field will be extracted from the document on insertion. Note that with this method, you cannot choose which field must have unique values nor can you set the document ID (a random one will be generated)

`indexModel` object:

```
{
	fieldName: {type: 'typeName', unique: true||false, id: true||false},
	...
}
```

Notes:
* `type` must be equal to one of the following : 'string', 'date', 'number', 'boolean', 'object', 'array', 'buffer', '\*'
* `unique` and `id` parameters are optional. If not defined, they are then assumed as `false`
* a field set as `id` is also implicitly unique
* you can only set one field as ID. If you transgress this rule, the collection construction will return an error
