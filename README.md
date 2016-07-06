# Lawncipher

[Lawnchair](http://brian.io/lawnchair) and [MongoDB](https://www.mongodb.org)-inspired [libsodium](https://github.com/jedisct1/libsodium)-backed encrypted persistent document storage. Designed (and [tested](#testing)) for [Cordova](http://cordova.apache.org)/[Phonegap](http://phonegap.com) and [Node.js](https://nodejs.org)

## Goal

Building a rather versatile and persistent encrypted document storage.

## Design

* Lawncipher is a document store
* The entirety of Lawncipher data is encrypted using either a password or a 256-bit key. (In case a password is used, it is transformed into a root key using [scrypt](http://www.tarsnap.com/scrypt.html))
* Instead of tables containing rows, Lawncipher has collections containing documents
* A document in Lawncipher has a unique ID and at least one of these two things:
    * A blob : could a JSON object, a string or arbitrary binary data (in a `Uint8Array`). It is stored encrypted and stored in a dedicated file, and decrypted when retrieved from the collection.
    * An indexData : An object, containing the query-able attributes of the document, stored in the collection's index.
* Lawncipher is blob-first: when running a query, and the result list is being built, for a given result document, the result list will contain its blob. If the document doesn't have a blob, the indexData will take its place in the result list.
* A schema, called "Index model", can be set for the indexData in a given collection. This schema gives the list and type of attributes that will be stored in the index. It can also determine whether a given attribute gives the IDs to the documents of the collection; as well as whether the value of a given attribute must be unique across the collection (without giving document IDs).
* When inserting a document, if a JSON object is given, the indexData can be [implicitly extracted from the document](httpsL//github.com/LockateMe/Lawncipher/blob/master/doc/API.md#collectionsavedoc-cb-overwrite-ttl).
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

__Lawncipher__
Retrieving a document by its ID (here, 'abc')

```js
Collection.find('abc', callbackFunction)
```

-----------------

__Lawncipher__
```js
Collection.find({firstName: 'Steve', lastName: 'Jobs'}, callback)
```
__SQL__
```sql
SELECT * FROM tableName WHERE firstName = 'Steve' AND lastName = 'Jobs'
```

-----------------

__Lawncipher__
```js
Collection.find({firstName: 'Steve', $not: {lastName: 'Jobs'}}, callback)
```
__SQL__
```sql
SELECT * FROM tableName WHERE firstName = 'Steve' AND lastName <> 'Jobs'
```

-----------------

__Lawncipher__
```js
Collection.find({$or: [{firstName: 'Steve'}, {lastName: 'Jobs'}]}, callback)
```
__SQL__
```sql
SELECT * FROM tableName WHERE firstName = 'Steve' OR lastName = 'Jobs'  
```

-----------------

__Lawncipher__
```js
Collection.find({firstName: 'Steve', $or: [{lastName: 'Wozniak'}, {lastName: 'Jobs'}])
```
__SQL__
```sql
SELECT * FROM tableName WHERE firstName = 'Steve' AND (lastName = 'Wozniak' OR lastName = 'Jobs')
```

-----------------

__Lawncipher__
```js
Collection.find({firstName: 'Steve', $sort: {lastName: 'asc'}, $skip: 100}, callback, 100)
```

__SQL__
```sql
SELECT * FROM tableName WHERE firstName = 'Steve' ORDER BY lastName ASC LIMIT 100 OFFSET 100
```
(get the 101-200 guys who are called Steve, ordered alphabetically by lastName)

## Testing

Here is how you can run unit tests in the compatible runtimes

### Node.js

Go to the directory where the Lawncipher library is located, and run

```shell
npm test
```

### Cordova/Phonegap

A [small test app](https://github.com/LockateMe/Lawncipher-cordova-test) has been built for that purpose.

## API

The Lawncipher API is documented [here](https://github.com/LockateMe/Lawncipher/blob/master/doc/API.md).

## Internals and file formats

The Lawncipher interals and file formats are documented [here](https://github.com/LockateMe/Lawncipher/blob/master/doc/Internals.md).

## License

Lawncipher is licensed under the terms of the MIT license.
