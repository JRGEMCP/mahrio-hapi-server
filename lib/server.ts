import * as Hapi from 'hapi';
import * as Good from 'good';
import * as Path from 'path';
import * as fs from 'fs';
import * as Inert from 'inert';
import * as request from 'request';

export class Server {
    public app;
    private env;
    private cfg;
    constructor( cfg ) {
        this.cfg = cfg;
        this.env = {
            port: cfg.host.port || 3011,
            routes: {
                files: {
                    relativeTo: Path.join(__dirname, '../')
                }
            }
        }
        if( cfg.host && cfg.host .url ) {
            this.env.host = cfg.host.url;
        }
        this.app = Hapi.server(this.env);
        this.app.register(Inert);
        try {
            const packageJson = fs.readFileSync( this.cfg.baseDir + '/../../../package.json');
            this.cfg.version = JSON.parse( packageJson.toString() ).version;
        } catch( e ) {
            console.log(e);
        }
    }
    setupAuthorizationToken(){

    }
    setupDownstreams() {
        if( this.cfg['downstreams'] ) {
            this.cfg['downstreams'].map( element => {
                const suffix = element['suffix'] || '';
                this.app.route({
                    path: element.prefix + suffix,
                    method: ['GET','POST','PUT','DELETE'],
                    handler: (req, h) => {
                        let headers = {};
                        const requestConfig = {
                            url: element.host + element.root + (suffix && suffix === '/:any(*)' ? req.params.any : ''),
                            method: req.method
                        };
                        if ( element.pHeaders ) {
                            headers = element.pHeaders;
                        }
                        if ( element.eHeaders ) {
                            element.eHeaders.map( (h) => {
                            headers[h] = req.headers[h];
                            })
                        }
                        requestConfig['headers'] = headers;
            
                        return new Promise( (resolve) => {
                            request( requestConfig, (err, response, body) => {
                                console.log(`\nProxy Request ==>`);
                                console.log(` Path: ${element['prefix'] + suffix}`);
                                console.log(` Dest: ${requestConfig.url}`);
                                for( const k in headers ) {
                                    console.log(`  ${k}: ${headers[k]}`);
                                }
                                if( err && !response) {
                                    return resolve( h.response(err).code( 404 ) );
                                } else {
                                    return resolve( h.response( body ).code( response.statusCode  ));
                                }
                            }); 
                        });
                    }
                })
            });
          }
    }
    setupStaticApps() {
        if( this.cfg['uis'] ) {
            this.cfg['uis'].map( app => {
                this.app.route({
                    path: app.route + '/{any}',
                    method: 'GET',
                    handler: (request, reply) => {
                        const appEntry = this.cfg['baseDir'].split('/');
                        appEntry.pop();
                        const fileSearch = `${appEntry.join('/')}/${app.name}/${app.env?app.env+'/':''}${request.params.any}`;

                        if( fs.existsSync( fileSearch ) ){
                            return reply.file(  fileSearch );
                        } else {
                            return reply.file(  `${appEntry.join('/')}/${app.name}/${app.env?app.env+'/':''}index.html` );
                        }
                    }
                });
                this.app.route({
                    path: app.route + '/{any*}',
                    method: 'GET',
                    handler: (request, reply) => {
                        const appEntry = this.cfg['baseDir'].split('/');
                        appEntry.pop();
                        const fileSearch = `${appEntry.join('/')}/${app.name}/${app.env?app.env+'/':''}${request.params.any}`;

                        if (request.params.any) {
                            if (fs.existsSync( fileSearch ) ) {
                                return reply.file(  fileSearch );
                            } else {
                                return reply.file( `${appEntry.join('/')}/${app.name}/${app.env?app.env+'/':''}index.html` );
                            }
                        } else {
                            return reply.file( `${appEntry.join('/')}/${app.name}/${app.env?app.env+'/':''}index.html` );
                        }
                    }
                });
            });
        }
    }
    setupHealthchecks(){
        this.app.route({
            method:'GET',
            path:'/healthcheck',
            handler: (request,h) => {
                try {
                    return {uptime: process.uptime(), version: this.cfg.version};
                } catch( e ) {
                    return {error: e.toString()};
                }
            }
        });
    }
    boot() {
        return new Promise( async (resolve, reject) => {
            const options = {
                ops: {
                    interval: 1000
                },
                reporters: {
                    mahrioReporter: [
                        {
                            module: 'good-squeeze',
                            name: 'Squeeze',
                            args: [{ log: '*', response: '*' }]
                        },
                        {
                            module: 'good-console'
                        },
                        'stdout'
                    ]
                }
            };
            try {
                await this.app.register({
                    plugin: Good,
                    options
                });
                await this.app.start();
                
            }
            catch (err) {
                console.log(err);
                reject(err);
                process.exit(1);
            }
            console.log('Server running at:', this.app.info.uri);
            resolve( this.app );
        });
    }
}
