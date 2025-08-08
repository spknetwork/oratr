#!/usr/bin/env node

const FFmpegBinaryManager = require('../src/core/binaries/ffmpeg-binary');

async function main() {
  const manager = new FFmpegBinaryManager();
  
  try {
    console.log('Installing FFmpeg binaries for Oratr...\n');
    
    const paths = await manager.install();
    
    console.log('\n✓ FFmpeg binaries installed successfully!');
    console.log(`  FFmpeg: ${paths.ffmpegPath}`);
    console.log(`  FFprobe: ${paths.ffprobePath}`);
    
    // Verify installation
    console.log('\nVerifying installation...');
    const verified = await manager.verify();
    
    if (verified) {
      console.log('✓ FFmpeg is working correctly!\n');
    } else {
      console.error('✗ FFmpeg verification failed. Please check the installation.\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n✗ Failed to install FFmpeg:', error.message);
    console.error('\nYou can manually install FFmpeg from: https://ffmpeg.org/download.html');
    process.exit(1);
  }
}

main();