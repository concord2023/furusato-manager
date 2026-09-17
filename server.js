// Minimal backend boundary for OAuth. No provider passwords or client secrets belong in the PWA.
// Configure secrets through environment variables when deploying.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=__dirname;
const providers={
 'google-drive':{authorize:'https://accounts.google.com/o/oauth2/v2/auth',scope:'https://www.googleapis.com/auth/drive.readonly'},
 'yahoo-mail':{authorize:'https://api.login.yahoo.com/oauth2/request_auth',scope:'mail-r'}
};
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function serve(res,p){const file=p==='/'?'index.html':p.replace(/^\/+/,'');const full=path.join(root,file);if(!full.startsWith(root)||!fs.existsSync(full)||fs.statSync(full).isDirectory())return json(res,404,{error:'not_found'});const ext=path.extname(full);const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});fs.createReadStream(full).pipe(res)}
function oauthStart(provider,res){const cfg=providers[provider];if(!cfg)return json(res,404,{error:'unknown_provider'});const clientId=process.env[provider==='google-drive'?'GOOGLE_CLIENT_ID':'YAHOO_CLIENT_ID'];const redirect=process.env[provider==='google-drive'?'GOOGLE_REDIRECT_URI':'YAHOO_REDIRECT_URI'];if(!clientId||!redirect)return json(res,503,{error:'oauth_not_configured',provider});const state=crypto.randomBytes(24).toString('hex');const u=new URL(cfg.authorize);u.searchParams.set('client_id',clientId);u.searchParams.set('redirect_uri',redirect);u.searchParams.set('response_type','code');u.searchParams.set('scope',cfg.scope);u.searchParams.set('state',state);res.writeHead(302,{Location:u.toString(),'Set-Cookie':`oauth_state=${state}; HttpOnly; SameSite=Lax; Secure; Path=/`});res.end();}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/oauth/google-drive/start')return oauthStart('google-drive',res);if(u.pathname==='/api/oauth/yahoo-mail/start')return oauthStart('yahoo-mail',res);if(u.pathname==='/api/health')return json(res,200,{ok:true});return serve(res,u.pathname)});
server.listen(process.env.PORT||3000,()=>console.log('furusato manager server listening'));
