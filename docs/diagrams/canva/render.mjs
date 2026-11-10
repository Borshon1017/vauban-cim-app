import {Resvg} from '@resvg/resvg-js'; import fs from 'fs';
const [,, inp, out, scale='1'] = process.argv;
const F='../fonts/';
const r=new Resvg(fs.readFileSync(inp,'utf8'),{fitTo:{mode:'zoom',value:+scale},font:{fontFiles:['BebasNeue-Regular.ttf','Lato-Regular.ttf','Lato-Bold.ttf','Poppins-Regular.ttf','Poppins-SemiBold.ttf','OpenSans.ttf','Montserrat.ttf'].map(f=>F+f),loadSystemFonts:false,defaultFontFamily:'Lato'}});
fs.writeFileSync(out,r.render().asPng());
