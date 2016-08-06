# Document/index model (`indexModel`):

A schema, called "Index model", can be set for the indexData in a given collection. This schema gives the list and type of attributes that will be stored in the index. It can also determine whether a given attribute gives the IDs to the documents of the collection; as well as whether the value of a given attribute must be unique across the collection (without giving document IDs).

You have 2 possible ways to describe your `indexModel`:
* You provide an object describing field to be extracted/provided by the user, to be inserted in the index file of the collection. You can define which field values must be unique (across the collection), which one will be chosen as docId, and which ones have their own search index.
* You provide an array of strings, where each string is a field name. Each field will be extracted from the document on insertion. Note that with this method, you cannot choose which field must have unique values nor can you set the document ID (a random one will be generated)

The "object" way is obviously more complete and versatile.

Here is an `indexModel` object:

```
{
	fieldName: {type: 'typeName', unique: true||false, id: true||false, index: true||false},
	...
}
```

Each indexed field has a description. Here are some details about that description
* In an indexModel, you can only set one field as `id`. If you transgress this rule, the collection construction will return an error
* `type` must be equal to one of the following : 'string', 'date', 'number', 'boolean', 'object', 'array', 'buffer', '\*'
* `unique` and `id` parameters are optional. If not defined, they are then assumed as `false`
* a field set as `id` is also implicitly unique
* a field marked as `id` must be of type 'string' or 'number'

## Example indexModel
