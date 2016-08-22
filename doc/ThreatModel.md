# Lawncipher threat model

Here are assumptions about the user and his device:
* The user acts reasonably and in good faith. This means that the user is conscious of the limits of the security of Lawncipher and acts accordingly. This includes to not share the password or root key with a potential attacker.
* To protect his Lawncipher database, the user sets a strong password or a randomly generated 32 bytes root key
* The user's device is not infected by malware that can read the main memory or that can monitor the execution and method calls inside a program
* The user's device executes Lawncipher's code correctly
* __The user doesn't use sensitive information as document identifiers__
* __The user doesn't use sensitive information in the name of indexed fields__

Here are some assumptions about the world:
* The security assumptions of XSalsa20, Poly1305 MAC and Scrypt are correct
* The implementations of the above mentionned algorithms in Libsodium are correct
* The compiled and/or bound versions of the algorithms, as used in Lawncipher, are correct. This means that we assume:
  * For Libsodium.js, Emscripten's compiles C code to JavaScript correctly and that the Libsodium.js wrappers are correct
  * The cordova-plugin-minisodium bindings for iOS and Android are correct

Here is what an attacker is able to achieve:
* The attacker is able to read from/write to the device's file system
* The attacker can monitor changes in the device's file system, such as the last modification dates, file sizes, file addition or deletion
* The attacker is able to see the name of the available collections and their indexed fields
* The attacker is able to roughly estimate the total size of the data stored in a given collection
* For each document that has a blob, the attacker is able to read its document ID.
