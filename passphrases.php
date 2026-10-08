<?php
// Active session passphrases. Only these can be used to join a session.
// - Add a line to open a new session; share the passphrase with the class.
// - Remove (or comment out) a line to close it: nobody can join or keep using it,
//   and its photos are deleted 48h after the last login/upload as usual.
// - Matching ignores upper/lower case and surrounding spaces.
return [
    'workshop-demo',
    // 'portrait-tuesday',
];
