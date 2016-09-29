# Lawncipher API

## `Lawncipher.init([cryptoProviderName])`
Lawncipher initialization method. Must be called once before beginning to use Lawncipher databases and collections.
* `String cryptoProviderName` : optional. the name of the library that will provide the cryptographic operations. Allowed values are:
  - `"minisodium"` : to use [cordova-plugin-minisodium](https://github.com/LockateMe/cordova-plugin-minisodium). Throws an exception if `MiniSodium` is missing
  - `"?minisodium?"` : to try to use cordova-plugin-minisodium, falls back to libsodium.js if MiniSodium is missing
  - `"libsodium"`, `"sodium"`, `"nacl"` to use libsodium.js

## `new Lawncipher.db(rootPath, [fs])`
Constructor method
* `String rootPath` : root Lawncipher directory path
* `Object fs` : The filesystem object to be used by the Lawncipher instance. Required when running in Cordova; the instance must come from [cordova-plugin-file-node-like](https://github.com/LockateMe/cordova-plugin-file-node-like)

## `Lawncipher.useCordovaPluginScrypt()`
Call this function to tell Lawncipher to use [cordova-plugin-scrypt](https://github.com/Crypho/cordova-plugin-scrypt) when it needs to derive passwords into encryption keys. To be called only if the scrypt plugin is installed.
__NOTE:__ Although you can use `crypto-plugin-scrypt` in addition to `cordova-plugin-minisodium`, it is however redundant.

## `Lawncipher.setScryptProvider(scryptProvider, useAsynchronously)`
* Function|String scryptProvider. The function that will be used as scrypt provider. The function must have the following interface : (String password, Uint8Array salt, Number opsLimit, Number r, Number p, Number keyLength, [Function callback(err, derivedKey)]). To reset the provider to the default one (using libsodium.js), pass `'default'` or `'reset'` instead of a function.
* Boolean useAsynchronously : to be set as `true` if the scryptProvider is asynchronous and will use the `callback(err, derivedKey)` to pass its result.

## `db.open(rootKey, callback)`
Open the Lawncipher document store, with a root encryption key
* `Uint8Array rootKey` : the Lawncipher root key. Must be 256 bits / 32 bytes long
* `Function callback` : callback function. Receiving only an `err` string, that is defined in case an error occurred while opening the DB. This callback function is invoked when the DB collection list has been loaded

## `db.openWithPassword(password, callback)`
Open the Lawncipher document store, with a user-provided password
* `String password` : the password, that will be derived into a 32 bytes rootKey by scrypt
* `Function callback` : callback function. Receiving only an `err` string, that is defined in case an error occurred while opening the DB. This callback function is invoked when the DB collection list has been loaded

## `db.close()`
Close Lawncipher, if open

## `db.isOpen()`
Returns a boolean, indicating whether Lawncipher is open or not

## `db.collection(name, callback, [indexModel])`
Open an existing Lawncipher collection, or creates it if it doesn't exist
* `String name` : the collection's name
* `Function callback` : callback function, receiving errors or the constructed Collection object (`function(err, collection)`)
* `Object|Array<String> indexModel` : the index model. The attributes that will be extracted and/or saved in the collection's \_index file. The query-able data. If the collection already exists, this parameter will simply be ignored. Optional parameter.
* returns the constructed `Collection` object

## `db.collections(callback)`
Getting the names of existing collections
* `Function callback(err, collectionsNames)` : callback function receiving an error or the collectionsNames array of strings
* Returns the collectionsNames array of strings

## `db.dropCollection(collectionName, callback)`
Deleting an existing collection. Note that this operation once invoked cannot be undone.
* `String collectionName` : the name of the collection to be deleted
* `Function callback` : the callback function, receiving `(err)`, a string briefly describing the error, if one occurred

## `Collection.getIndexModel()`
Get a copy of the IndexModel currently enforced on the indexed data of the collection

## `Collection.setIndexModel(indexModel, cb, [doNotApplyModel])`
Set a new IndexModel for the current collection. Performs all the compatibility checks (via isIndexModelCompatible; unless the `doNotApplyModel == true`)
* `Object indexModel` : the new index model that we want to use
* `Function callback` : callback function, receiving `(err, offendingDocs)`.
  * `err` is defined if an error occurred; it is most likely a string succinctly describing the error.
  * `offendingDocs` is defined if there are documents that offend the new `indexModel`. It is built as `Hash<DocId, Hash<FieldName, Array<OffendingReason>>>`, where `OffendingReason` is a string and is equal to `not_unique` or `type_mismatch`.
* `Boolean [doNotApplyModel]` : optional parameter. If true, fields that were indexed in the previous model are not removed from the index after the adoption of the new model. Search indices built for these now-removed-from-model fields are not deleted either; Lawncipher will continue to use them to speed up searches, but they will stop being updated.

## `Collection.clearIndexModel(cb, doNot)`
Remove the existing

## `Collection.isIndexModelCompatible(indexModel, cb)`

## `Collection.save(doc, cb, [overwrite], [ttl])`
Save a document/blob in the current collection.
* `Doc doc` : The document to be saved.  
`Doc` is either of type `String`, `Uint8Array` or `Object`.  
If it is a `String` or a `Uint8Array` or an `Array`, it is saved as a blob, and it is only retrievable with the docId passed in the callback `cb` function.  
If it is a "standard" `Object` (key-value mapping object), there are two modes available:  
  - Explicit mode: tell Lawncipher what is to be stored as blob (the value of the `__blob` attribute), what to be stored as index data (the value of the `__index` attribute), and what is the doc's TTL. When using that mode, at least one of `__index` and `__blob` must be defined. `__ttl` is optional. Example `doc`:
  ```js
  {__blob: 'Hello world', __index: {attr1: value1, attr2: value2, ...}, __ttl: 5000}
  ```
  - Implicit mode: Lawncipher determines what needs to be stored where, based on the indexModel.  
    If the `doc` has no extraneous attributes (compared to the indexModel), then it is stored as indexData only.  
    If the `doc` has extraneous attributes (compared to the indexModel), then it is stored as both indexData and blob, where the blob would hold the document with the extraneous attributes (that cannot fit in the indexModel)  
    __NOTE:__ If the collection has no indexModel, then the `doc` is stored as a blob as is only retrievable by its docId  
    __NOTE:__ Index data cannot BE an array (at the highest level). However, index data can contain arrays as the value of attributes. If `doc` turns out to be an array, it is stored as a blob without index data and will be retrievable with its docId only
* `Function cb` : callback function. Receiving `(err, docId)`, where `err` is a string briefly describing the error, if one occurred; and `docId` is the Id attributed to the saved document.
* `Boolean overwrite` : a boolean indicating whether this new document can overwrite an other that uses the same ID. Optional parameter.
* `Number|Date ttl` : "Time To Live" (TTL) for the document (in milliseconds) or date of expiry. Note that this parameter is overridden if the explicit mode is used and a `__ttl` attribute is passed to the method. Optional parameter.

## `Collection.bulkSave(docs, cb, [overwrite], [ttls])`
Save a list of documents/blobs in the current collection. Note that when `ttls` is provided as an array, it must have the same length as `docs`. (ttls[0] will be used docs[0], ttls[1] for docs[1], and so on...)
* `Array<Doc> docs` : the list of documents to be saved (see the documentation of `collection.save()` to understand what is `Doc`)
* `Function cb` : callback function. Receiving `(err, docIDs)`, where `err` is a string or an `Error`-related object, if an error occurred, and `docIDs` is the array of IDs attributed to the documents that have been saved the call (with the same index correspondence).
* `Boolean overwrite` : a boolean telling whether existing docs can be overwritten.
* `Number|Date|Array<Number|Date> ttls` : a TTL value, or an array with TTL values

## `Collection.update(q, newData, callback, [indexOnly])`
Update a existing documents (index or blob data)
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Object|String|Uint8Array newData` : the data that will be used to update/replace the matched documents
* `Function callback` : callback function. Receiving `(err, updatedCount)`, where `err` is a string briefly describing the error, if one occured; and updatedCount is the number of documents that have been updated
* `Boolean indexOnly` : if an updated doc has a JSON blob and indexData, this parameter ensures that only the index will be updated with `newData`.

## `Collection.find(q, cb, [limit])`
Find documents in the current collection. If a matched document doesn't have blob, its index data is returned.
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function cb(err, docs)` : callback function. Receives the matched docs or the error that occurred
* `Number limit` : The maximum number of documents to be returned. Optional parameter.

## `Collection.findOne(q, cb)`
Find a single document in the current collection, matching the provided query. As in `Collection.find`, if a matched document doesn't have blob, its index data is returned.
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function cb(err, doc)` : callback function. Receives the matched doc or the error that occurred

## `Collection.remove(q, cb)`
Remove from the collection the documents matched by the query q
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function callback(err)` : callback function. Called when the removal of the matched documents is completed, or when an error occurs.

## `Collection.count(q)`
Count the documents in the collection that match the provided query. Can also be used to test the existence of a document
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* Returns the count result (`Number`)

## `Collection.size(cb)`
Get an approximate size (in bytes) of the current collection
* `Function cb(err, size)` : Optional. Result is returned in case no `cb` parameter is passed

## `Collection.setTTL(q, ttl, cb)`
Set/update the TTL with value `ttl` for the documents matched by the query `q`
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Number|Date|Null|Undefined ttl` : Time-to-live for the documents matched by `q`. If it's a number, it will be counted as milliseconds from the current instant. If it's a date, it's used as-is as TTL date for the documents. If ttl == 0 or ttl == null or ttl is undefined, this will remove any TTL for the selected documents.
* `Function cb` : callback function. Receives the error, if one occurred

## `Collection.getTTL(q, cb)`
Get the TTLs of the documents matched by the query `q`. Results is a hash<docId, ttlUtcEpoch>
* `String|Object q` : query. Must either be an object (compound query) or a string (docId)
* `Function cb` : callback function. Optional. If omitted, the result is returned.

## `Collection.close()`
Close, if open, the current collection

## `Collection.__save(blob, index, cb, overwrite, ttl)`
Save a document/blob in the current collection. Prior to Lawncipher v2, this method (with the same parameters) was named `save`
* `Object|String|Uint8Array blob` : the raw document to be saved as an independent encrypted (un-query-able) file. Optional parameter
* `Object|Array<String> index` : index data. The qurey-able data for the document to be saved. A standard JS object. Can also be an array of strings in case blob is a standard JS object; the array indicates the names of the fields to be extracted from the blob and to be saved in the index
* `Function cb` : callback function. Receiving `(err, docId)`, where `err` is a string briefly describing the error, if one occurred; and `docId` is the Id attributed to the saved document.
* `Boolean overwrite` : a boolean indicating whether this new document can overwrite an other that uses the same ID. Optional parameter.
* `Number|Date ttl` : TTL for the document (in milliseconds) or date of expiry. Optional parameter.

## `Collection.__bulkSave(blobs, indices, cb, overwrite, ttls)`
Save a list of documents/blobs in the current collection. Note that when provided as arrays, `blobs`, 'indices' and `ttls` must have the same length. There must be also an index correspondence (ie, blobs[0] and indices[0] and ttls[0] will correspond to the same doc when saved). Prior to Lawncipher v2, this method (with the same parameters) was named `bulkSave`
* `Array<Object|String|Uint8Array> blobs` : the list of documents to be saved in the collection
* `Array<Object|Array<String>> indices` : the list of query-able index data to be saved in the collection
* `Function cb` : callback function. Receiving `(err, docIDs)`, where `err` is a string or an `Error`-related object, if an error occurred, and `docIDs` is the array of IDs attributed to the documents that have been saved the call (with the same index correspondence).
* `Boolean overwrite` : a boolean telling whether existing docs can be overwritten.
* `Number|Date|Array<Number|Date> ttls` : a TTL value, or an array with TTL values

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
