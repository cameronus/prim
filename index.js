#!/usr/bin/env node

const os = require('os')
const fs = require('fs')
const path = require('path')
const util = require('util')
const crypto = require('crypto')
const cp = require('child_process')
const program = require('commander')
const { performance } = require('perf_hooks')
const exec = util.promisify(cp.exec)
const { spawn } = cp
const ProgressBar = require('progress')

const default_n = 1000

program
  .version(require('./package.json').version)

  .option('-i, --input <file>', 'input file path')
  .option('-o, --output <file>', 'output file path')

  .option('-b, --begin <n>', 'beginning n', default_n)
  .option('-e, --end <n>', 'ending n', default_n)

  .option('-m, --mode <mode>', 'primitive mode', '1')
  .option('-r, --resize <resize>', 'resized resolution before processing', '256')
  .option('-s, --size <size>', 'output image size', '1024')

  .option('-d, --debug', 'debug mode')

program.parse(process.argv)

if (program.debug) console.log(program.opts())
if (!program.input) return console.log('Error: Please enter a file to process.')
if (!program.output) return console.log('Error: Please enter an output path.');

(async () => {
  try {
    const parsed = path.parse(program.input)
    const parsed_out = path.parse(program.output)
    const input = fs.createReadStream(program.input)
    const hash = crypto.createHash('sha256')
    for await (const data of input) {
      hash.update(data)
    }
    const job_id = hash.digest('hex').substring(0, 8)
    const temp_dir = os.tmpdir() + '/prim-' + job_id
    if (!fs.existsSync(temp_dir)) fs.mkdirSync(temp_dir)
    const probe = JSON.parse((await exec(`ffprobe -v quiet -print_format json -show_format -show_streams ${program.input}`)).stdout)
    const num_frames = probe.streams[0].nb_frames
    const frac = probe.streams[0].r_frame_rate.split('/')
    const frame_rate = Math.round(frac[0] / frac[1])
    console.log(`Running job on file: ${parsed.base} (${job_id}) [${num_frames} frames]`)
    if (!fs.existsSync(`${temp_dir}/1.png`)) {
      console.log('Converting to frames...')
      await exec(`ffmpeg -i ${program.input} ${temp_dir}/%d.png`)
    }
    const list = Array.from({ length: num_frames }, (v, e) => e + 1)
    let time
    for (const i of list) {
      const n = parseInt(((i - 1) / (num_frames - 1)) * (program.end - program.begin) + parseInt(program.begin))
      if (fs.existsSync(`${temp_dir}/processed-${i}.png`)) continue
      process.stdout.cursorTo(0)
      process.stdout.write('ok\r')
      const bar = new ProgressBar(`Processing frame ${i} (:times) [:bar] :current/${n} `, {
        total: n,
        complete: '=',
        incomplete: ' ',
        clear: true,
        callback: () => process.stdout.clearLine()
      })
      const start = performance.now()
      await new Promise((resolve, reject) => {
        const job = spawn('primitive', [ '-i', `${temp_dir}/${i}.png`, '-o', `${temp_dir}/processed-${i}.png`, '-n', n, '-v', '-m', program.mode, '-r', program.resize, '-s', program.size ], {
          env: {
            PATH: process.env.PATH
          }
        })
        job.stdout.on('data', data => bar.tick({ time: time || '?' }))
        job.on('exit', code => resolve(code))
        job.on('error', err => reject(err))
      })
      time = parseInt((performance.now() - start) / 1000)
    }
    console.log(`Finished processing. Outputting to ${parsed_out.base}...`)
    await exec(`ffmpeg -framerate ${frame_rate} -pattern_type glob -i '${temp_dir}/processed-*.png' -c:v libx264 -pix_fmt yuv420p ${program.output} -y`)
  } catch (e) {
    console.log('Error:', e)
  }
})()

// ffmpeg -i input.mp4 output_%04d.png
// for i in raw/*; do primitive -i $i -o processed/$i -n 100; done
// ffmpeg -framerate 24 -pattern_type glob -i 'processed/raw/*.png' -c:v libx264 -pix_fmt yuv420p out.mp4
