#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Create a minimal valid MP4 file for testing
// This is a tiny valid MP4 file (video/mp4 MIME type)
const createSampleVideo = () => {
  // Minimal MP4 file structure (ftyp + mdat boxes)
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x20, // box size (32 bytes)
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6F, 0x6D, // 'isom'
    0x00, 0x00, 0x00, 0x00, // minor version
    0x69, 0x73, 0x6F, 0x6D, // compatible brands
    0x69, 0x73, 0x6F, 0x32,
    0x6D, 0x70, 0x34, 0x31
  ]);

  // Minimal mdat box with some data
  const mdatHeader = Buffer.from([
    0x00, 0x00, 0x00, 0x10, // box size (16 bytes)
    0x6D, 0x64, 0x61, 0x74  // 'mdat'
  ]);
  
  const mdatData = Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
  ]);

  return Buffer.concat([ftyp, mdatHeader, mdatData]);
};

// Create the sample video file
const outputPath = path.join(__dirname, 'sample-video.mp4');
const videoData = createSampleVideo();

fs.writeFileSync(outputPath, videoData);
console.log(`Created sample video file: ${outputPath}`);
console.log(`File size: ${videoData.length} bytes`);

// Also create a sample thumbnail
const createSampleThumbnail = () => {
  // Minimal JPEG file (just headers, no actual image data)
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, // JPEG SOI and APP0 marker
    0x00, 0x10, // APP0 length
    0x4A, 0x46, 0x49, 0x46, 0x00, // 'JFIF\\0'
    0x01, 0x01, // JFIF version
    0x00, // aspect ratio units
    0x00, 0x01, // X density
    0x00, 0x01, // Y density
    0x00, 0x00, // thumbnail width/height
    0xFF, 0xD9  // EOI marker
  ]);
};

const thumbnailPath = path.join(__dirname, 'sample-thumbnail.jpg');
fs.writeFileSync(thumbnailPath, createSampleThumbnail());
console.log(`Created sample thumbnail: ${thumbnailPath}`);