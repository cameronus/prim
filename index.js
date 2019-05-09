#!/usr/bin/env node

const program = require('commander')
const exec = require('child-process-promise').exec
const crypto = require('crypto')
const path = require('path')
const os = require('os')
const fs = require('fs')

const default_n = 1000

program
  .version(require('./package.json').version)
  .option('-i, --input <file>', 'input file path')
  .option('-o, --output <file>', 'output file path')
  .option('-s, --start <n>', 'starting n', default_n)
  .option('-e, --end <n>', 'ending n', default_n)
  .option('-v, --verbose', 'verbose')
  .option('-d, --debug', 'debug mode')

program.parse(process.argv)

if (program.debug) console.log(program.opts())
if (!program.input) return console.log('Error: Please enter a file to process.')
if (!program.output) return console.log('Error: Please enter an output path.');

(async () => {
  const parsed = path.parse(program.input)
  const input = fs.createReadStream(program.input)
  const hash = crypto.createHash('sha256')
  for await (const data of input) {
    hash.update(data)
  }
  const job_id = hash.digest('hex').substring(0, 8)
  const temp_path = os.tmpdir() + '/' + job_id
  console.log(`Running job on file: ${parsed.base} (${job_id})`)
  const probe = JSON.parse((await exec(`ffprobe -v quiet -print_format json -show_format -show_streams ${program.input}`)).stdout)
  const num_frames = probe.streams[0].nb_frames
  console.log(`Video has ${num_frames} frames`)
  if (!fs.existsSync(`${temp_path}_0001.png`)) {
    console.log('Converting to frames')
    await exec(`ffmpeg -i ${program.input} ${temp_path}_%04d.png`)
  } else {
    console.log('Video already converted')
  }
  const list = Array.from({ length: num_frames }, (v, e) => e + 1)
  for (const i of list) {
    const n = parseInt(((i - 1) / (num_frames - 1)) * (program.end - program.start) + parseInt(program.start))
    const padded = i.toString().padStart(4, '0')
    if (fs.existsSync(`${temp_path}_processed_${padded}.png`)) {
      console.log(`Frame ${i} already processed`)
      continue
    }
    console.log(`Processing frame ${i}`)
    await exec(`primitive -i ${temp_path}_${padded}.png -o ${temp_path}_processed_${padded}.png -n ${n}`)
  }

})()


// ffmpeg -i input.mp4 output_%04d.png
// for i in raw/*; do primitive -i $i -o processed/$i -n 100; done
// ffmpeg -framerate 24 -pattern_type glob -i 'processed/raw/*.png' -c:v libx264 -pix_fmt yuv420p out.mp4
