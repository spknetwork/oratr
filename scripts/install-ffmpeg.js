#!/usr/bin/env node

const FFmpegBinaryManager = require('../src/core/binaries/ffmpeg-binary');

async function main() {
  const manager = new FFmpegBinaryManager();
  
  try {
    console.log('Checking FFmpeg installation for Oratr...\n');
    
    const paths = await manager.install();
    
    // Try to verify if paths exist
    const fs = require('fs');
    const ffmpegExists = fs.existsSync(paths.ffmpegPath);
    const ffprobeExists = fs.existsSync(paths.ffprobePath);
    
    if (ffmpegExists && ffprobeExists) {
      console.log('\n✓ FFmpeg is available!');
      console.log(`  FFmpeg: ${paths.ffmpegPath}`);
      console.log(`  FFprobe: ${paths.ffprobePath}`);
      
      // Try to verify it works
      const verified = await manager.verify();
      if (verified) {
        console.log('✓ FFmpeg is working correctly!\n');
      }
    } else {
      console.log('\n⚠️  FFmpeg is not installed yet.');
      console.log('The application will attempt to use system FFmpeg if available.');
      console.log('Or it will prompt you to install FFmpeg when needed.\n');
      // Don't exit with error - let the app handle missing FFmpeg
    }
  } catch (error) {
    console.log('\n⚠️  FFmpeg check completed with warnings.');
    console.log('The application will attempt to use system FFmpeg if available.\n');
    // Don't exit with error - this is optional
  }
}

main();