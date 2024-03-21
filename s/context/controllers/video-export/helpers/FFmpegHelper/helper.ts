import {signals} from "@benev/slate"
import {FFprobeWorker} from "ffprobe-wasm/browser.mjs"
import {FFmpeg} from "@ffmpeg/ffmpeg/dist/esm/index.js"
import {toBlobURL} from "@ffmpeg/util/dist/esm/index.js"
import {fetchFile} from "@ffmpeg/util/dist/esm/index.js"
import {AnyEffect, AudioEffect, VideoEffect} from "../../../timeline/types.js"

export class FFmpegHelper {
	ffmpeg = new FFmpeg()
	ffprobe = new FFprobeWorker()
	is_loading = signals.op<any>()

	constructor() {
		this.is_loading.load(async() => await this.#load_ffmpeg())
		console.log("loaded")
		this.ffmpeg.on("log", (log) => console.log(log))
	}

	async #load_ffmpeg() {
		const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.5/dist/esm'
		await this.ffmpeg.load({
			coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
			wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
			workerURL: await toBlobURL("https://unpkg.com/@ffmpeg/core-mt@0.12.5/dist/esm/ffmpeg-core.worker.js", "text/javascript")
		})
	}

	async write_composed_data(binary: Uint8Array, container_name: string) {
		await this.ffmpeg.writeFile(`${container_name}`, binary)
	}

	async merge_audio_with_video_and_mux(effects: AnyEffect[], video_container_name: string, output_file_name: string) {
		/* audio from video to add back to the raw video we composed that consitsts of just frames,
		* i decided to not use AudioDecoder etc, instead im just using ffmpeg to encode back audio to video
		*/
		const audio_from_video_effects = (effects.filter(effect => effect.kind === "video") as VideoEffect[])
		// those below are new audio effects to merge
		const added_audio_effects = (effects.filter(effect => effect.kind === "audio") as AudioEffect[])

		const all_audio_effects = [...audio_from_video_effects, ...added_audio_effects]


		for(const {file, id, kind, start, end} of all_audio_effects) {
			if(kind === "video") {
				await this.ffmpeg.writeFile(`${id}.mp4`,  await fetchFile(file))
				await this.ffmpeg.exec(["-ss", `${start / 1000}`,"-i", `${id}.mp4`,"-t" ,`${(end - start) / 1000}`, "-vn", `${id}.mp3`])
			} else {
				await this.ffmpeg.writeFile(`${id}x.mp3`,  await fetchFile(file))
				await this.ffmpeg.exec(["-ss", `${start / 1000}`,"-i", `${id}x.mp3`,"-t" ,`${(end - start) / 1000}`, "-vn", `${id}.mp3`])
			}
		}

		await this.ffmpeg.exec([
			"-i", `${video_container_name}`, ...all_audio_effects.flatMap(({id}) => `-i, ${id}.mp3`.split(", ")),
			"-filter_complex",
			`${all_audio_effects.map((effect, i) => `[${i + 1}:a]adelay=${effect.start_at_position}:all=1[a${i + 1}];`).join("")}
			${all_audio_effects.map((_, i) => `[a${i + 1}]`).join("")}amix=inputs=${all_audio_effects.length}[amixout]`,
			"-map", "0:v:0", "-map", "[amixout]","-c:v" ,"copy", "-c:a", "aac","-b:a", "192k", "-y", `${output_file_name}`
		])

	}

	async get_muxed_file(name: string) {
		return await this.ffmpeg.readFile(name) as Uint8Array
	}

	async get_frames_count(file: File) {
		const probe = await this.ffprobe.getFrames(file, 1)
		return probe.nb_frames
	}

}
