import fastify from "fastify";
import fsio from "fastify-socket.io";
import fStatic from "@fastify/static";
import Watcher from "watcher";
import {dirname, join, relative, resolve} from "path";
//@ts-ignore
import ip from "ip";
import type {FastifyInstance} from "fastify";
import watcher from "watcher";
import {createReadStream, existsSync, lstatSync, readdirSync, readFileSync} from "fs";
import ignore from "ignore";
import {fileURLToPath} from "url";
//@ts-ignore
import yazl from "yazl";

type initEasyshare = {
	path: string,
	port?: number,
	showAddress?: boolean
}

interface deepDir{
	files: Array<string>,
	dirs: {
		[key: string]: deepDir,
	},
	path: string,
}

export default class Easyshare{
	constructor(initEsayshare: initEasyshare){
		initEsayshare.port = initEsayshare.port || 80;
		initEsayshare.showAddress = initEsayshare.showAddress || false;
		
		this.app = fastify();
		
		//@ts-ignore
		this.app.register(fsio);
		this.app.register(fStatic, {
			root: dirname(fileURLToPath(import.meta.url)) + "/public",
			prefix: "/",
		});

		this.path = resolve(initEsayshare.path);
		this.setIgnoreFiles();
		this.archi = this.pathFinding(this.path);

		this.initRoute();
		this.initWatcher();

		this.app.listen({port: initEsayshare.port, host: "0.0.0.0"}, (err) => {
			if(initEsayshare.showAddress !== false)console.log("address : " + ip.address() + ":" + initEsayshare.port);
			console.log("Share is ready !");
		});
	}

	setIgnoreFiles(){
		let ignoreFiles = (
			existsSync(this.path + "/.shareIgnore") && readFileSync(this.path + "/.shareIgnore", "utf-8") !== "" ?
				readFileSync(this.path + "/.shareIgnore", "utf-8").split("\n")
				:
				[]
		);
		
		//@ts-ignore
		this.ignoreFiles = ignore({}).add(ignoreFiles);
		
	}

	pathFinding(path: string){
		let obj: deepDir = {
			dirs: {},
			files: [],
			path: path.replace(this.path, "."), 
		};

		for(const file of readdirSync(resolve(path))){
			let relativePath = relative(this.path, resolve(path, file));
			if(this.ignoreFiles.ignores(relativePath)) continue;
			if(lstatSync(resolve(path, file)).isDirectory()){
				obj.dirs[file] = this.pathFinding(resolve(path, file));
			}
			else obj.files.push(file);
		}

		return obj;
	}

	initRoute(){
		this.app.get("/files", (req, res) => {
			if(
				typeof req.query === "object" && 
				req.query !== null && 
				"path" in req.query && 
				req.query["path"] !== undefined && 
				typeof req.query["path"] === "string" &&
				req.query["path"].startsWith("./") &&
				req.query["path"].indexOf("..") === -1 &&
				existsSync(this.path + req.query["path"].replace(".", "")) === true &&
				lstatSync(this.path + req.query["path"].replace(".", "")).isDirectory() === false &&
				this.ignoreFiles.ignores(req.query["path"].replace("./", "")) === false
			){
				let file = createReadStream(this.path + req.query["path"].replace(".", ""), "utf-8");
				res.status(200).send(file);
			}
			else res.status(400).send();
		});

		this.app.get("/folders", (req, res) => {
			if(
				typeof req.query === "object" && 
				req.query !== null && 
				"path" in req.query && 
				req.query["path"] !== undefined && 
				typeof req.query["path"] === "string" &&
				req.query["path"].startsWith("./") &&
				req.query["path"].indexOf("..") === -1 &&
				existsSync(this.path + req.query["path"].replace(".", "")) === true &&
				lstatSync(this.path + req.query["path"].replace(".", "")).isDirectory() === true
			){
				let zipfile = new yazl.ZipFile();

				let pathFinding = (path: string) => {
					for(const file of readdirSync(join(this.path, path))){
						let relativePath = relative(this.path, join(this.path, path, file));
						if(this.ignoreFiles.ignores(relativePath)) continue;
						if(lstatSync(join(this.path, path, file)).isDirectory()){
							pathFinding(join(path, file));
						}
						else zipfile.addFile(join(this.path, path, file), join(path, file));
					}
				};
				pathFinding(req.query["path"]);

				zipfile.outputStream.pipe({
					on: () => {},
					once: () => {},
					emit: () => true,
					//@ts-ignore
					write: buffer => res.raw.write(buffer),
					end: () => res.raw.end(),
				});
				zipfile.end();
			}
			else res.status(400).send();
		});

		this.app.get("/archi", (req, res) => {
			res.send(this.archi);
		});

		this.app.get("/", (req, res) => {
			res.redirect("/index.html");
		});
	}

	initWatcher(){
		this.watcher = new Watcher(
			resolve(this.path),
			{
				//@ts-ignore
				ignore: path => {
					path = relative(this.path, path);
					if(!path) return false;
					else if(".shareIgnore" === path) return false;
					else if(path === "..") return true;
					else return this.ignoreFiles.ignores(path);
				},
				recursive: true,
				ignoreInitial: true,
			}
		);
		
		this.watcher.on("addDir", path => {
			this.archi = this.pathFinding(this.path);
			this.app.io.emit("archi", this.archi);
		});

		this.watcher.on("unlinkDir", path => {
			this.archi = this.pathFinding(this.path);
			this.app.io.emit("archi", this.archi);
		});

		this.watcher.on("add", path => {
			this.archi = this.pathFinding(this.path);
			this.app.io.emit("archi", this.archi);
		});

		this.watcher.on("unlink", path => {
			this.archi = this.pathFinding(this.path);
			this.app.io.emit("archi", this.archi);
		});
		
		this.watcher.on("change", path => {
			if(this.path + "/.shareIgnore" === path){
				this.setIgnoreFiles();
				this.archi = this.pathFinding(this.path);
				this.watcher.close();
				this.initWatcher();
				this.app.io.emit("archi", this.archi);
			}
			
			this.app.io.emit("change", path.replace(this.path, "."));
		});
	}

	private app: FastifyInstance;
	//@ts-ignore
	private watcher: watcher;
	private ignoreFiles: any;
	private path: string;
	private archi: deepDir;
}
