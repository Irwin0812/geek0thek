/* Vérif ciblée de la regex « comics & graphic novels ». */
const g = 'Comics & graphic novels';
const key = g.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
console.log('key:', key, '| codes:', [...key].map((c) => c.charCodeAt(0)).join(','));
console.log('regex directe :', /^comics? &? graphic novels?/.test(g.toLowerCase()));
console.log('regex sur clé  :', /^comics? &? graphic novels?/.test(key));
console.log('regex sans & strict :', /^comics? ?&? ?graphic novels?/.test(key));
console.log('regex simple    :', /^comics? graphic novels?$/.test(key.replace(/&?/g, '')));
