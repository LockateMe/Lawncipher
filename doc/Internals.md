# Lawncipher internals and file formats

## Root `_index` file model

```
[
 	{name: 'collection_name', key: '', indexModel: {}},
 	...
]
```

## Collection `_index` file model:

```
{
	indexModel: indexModelObjectOrArray,
    docCount: numberOfDocsInCollection,
    collectionSize: collectionSizeInBytes,
	documents: {
		"docId": documentIndexObject,
		...
	},
    pearsonSeed: [0-255 permutation]

}
```

__NOTE:__ the `documents` attribute in the model above is removed as soon as the collection begins to use index file fragmentation.

## Collection index fragment file model:

An index fragment file name is built as follows :  
`_`|indexName|`_`|rangePoint1|`_`|rangePoint2

Where:
* `|` is the concatenation operator
* `indexName` is `index` for the collection's main index, or is `_`|`attributeName` for an attribute/search index
* `rangePoint1` and `rangePoint2` are `rangePoint`s, where a `rangePoint` is a big-endian hexadecimal representation of 64 bit unsigned integer and `rangePoint1 <= rangePoint2`

The plaintext contents (before encryption) of an index fragment are:

```
{
    docId: documentIndexObject,
    ...
}
```

## Document index object model (`documentIndexObject`)

The object that describes a document in the index

```
{
    index: {extractedOrProvidedData},
    blobType: 'string|buffer|json' //Optional
    k: blob/file encryption key, //Optional. Only if the first `blob` parameter is provided when saving the document
    ttl: Time-to-live for the document. Unixepoch, in seconds. Optional
}
```

## Document/index model (`indexModel`):

Two versions possible:
* You provide an object describing field to be extracted/provided by the user, to be inserted in the index file of the collection. You can define which field values must be unique and which one will be chosen as docId
* You provide an array of strings, where each string is a field name. Each field will be extracted from the document on insertion. Note that with this method, you cannot choose which field must have unique values nor can you set the document ID (a random one will be generated)

`indexModel` object:

```
{
	fieldName: {type: 'typeName', unique: true||false, id: true||false, index: true||false},
	...
}
```

Notes:
* `type` must be equal to one of the following : 'string', 'date', 'number', 'boolean', 'object', 'array', 'buffer', '\*'
* `unique` and `id` parameters are optional. If not defined, they are then assumed as `false`
* a field set as `id` is also implicitly unique
* you can only set one field as ID. If you transgress this rule, the collection construction will return an error
