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
