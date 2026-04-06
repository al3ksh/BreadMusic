const sharp = require('sharp');
sharp('c:/Users/DELL/Documents/!WorkReleases/Bread/web/assets/breadicon.png')
  .resize(512, 512)
  .composite([
    {
      input: Buffer.from('<svg width="512" height="512"><rect x="0" y="0" width="512" height="512" rx="128" ry="128" fill="#fff"/></svg>'),
      blend: 'dest-in'
    }
  ])
  .png()
  .toFile('c:/Users/DELL/Documents/!WorkReleases/Bread/web/public/assets/breadiconpng.png', (err) => {
    if (err) console.error(err);
    else console.log('Successfully made transparent rounded corners icon.');
  });
