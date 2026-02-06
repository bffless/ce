#!/usr/bin/env node
/* eslint-disable */

/**
 * Script to test the createDeployment endpoint by uploading all files
 * from the coverage directory recursively
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const http = require('http');

// Load environment variables from .env.test-upload if it exists
const envPath = path.join(__dirname, '..', '.env.test-upload');
if (fs.existsSync(envPath)) {
  console.log(`Loading configuration from ${envPath}`);
  require('dotenv').config({ path: envPath });
}

// Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'your-api-key-here';
const REPOSITORY = process.env.REPOSITORY || 'test-org/test-repo';
const COMMIT_SHA = process.env.COMMIT_SHA || 'abc1234567890def';
const BRANCH = process.env.BRANCH || 'main';
const IS_PUBLIC = process.env.IS_PUBLIC === 'true';
const DESCRIPTION = process.env.DESCRIPTION || 'Test deployment from coverage files';
const COVERAGE_DIR = path.join(__dirname, '../coverage');
const BATCH_SIZE = 50; // Maximum files per deployment

/**
 * Recursively find all files in a directory
 */
function findFilesRecursively(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findFilesRecursively(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Upload a batch of files to createDeployment endpoint
 */
async function uploadBatch(files, batchNumber, totalBatches) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Batch ${batchNumber}/${totalBatches} - Uploading ${files.length} files`);
  console.log(`Commit SHA: ${COMMIT_SHA}`);
  console.log(`${'='.repeat(60)}`);

  // Create form data
  const form = new FormData();

  // Add metadata fields - same for all batches
  form.append('repository', REPOSITORY);
  form.append('commitSha', COMMIT_SHA);
  form.append('branch', BRANCH);
  form.append('isPublic', IS_PUBLIC.toString());
  form.append('description', DESCRIPTION);

  // Collect file paths for all files
  const filePaths = [];

  // Add all files in this batch
  console.log('\nAdding files to request:');
  files.forEach((filePath, index) => {
    const relativePath = path.relative(COVERAGE_DIR, filePath);
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;

    // Store the relative path
    filePaths.push(relativePath);

    // Append the file (Multer will strip the path from filename, which is fine now)
    form.append('files', fileStream, {
      filename: path.basename(filePath),
      contentType: getContentType(filePath),
    });

    if (index < 3) {
      // Debug: show first 3 relative paths
      console.log(`  DEBUG: relativePath = "${relativePath}"`);
    }
    console.log(`  ${index + 1}. ${relativePath} (${formatBytes(fileSize)})`);
  });

  // Add the file paths as a JSON array
  form.append('filePaths', JSON.stringify(filePaths));

  console.log('\n---');
  console.log('Uploading to API...');

  // Make the request
  const url = new URL('/api/deployments', API_BASE_URL);

  return new Promise((resolve, reject) => {
    const request = form.submit({
      protocol: url.protocol,
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 3000),
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        ...form.getHeaders(),
      },
    }, (err, res) => {
      if (err) {
        console.error('Error making request:', err.message);
        reject(err);
        return;
      }

      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`\nResponse status: ${res.statusCode} ${res.statusMessage}`);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('\n✓ Upload successful!');

          try {
            const response = JSON.parse(data);
            console.log('\nDeployment details:');
            console.log(`  Deployment ID: ${response.deploymentId}`);
            console.log(`  Commit SHA: ${response.commitSha}`);
            console.log(`  File count: ${response.fileCount}`);
            console.log(`  Total size: ${formatBytes(response.totalSize)}`);
            console.log(`\nURLs:`);
            console.log(`  SHA: ${response.urls.sha}`);
            if (response.urls.branch) {
              console.log(`  Branch: ${response.urls.branch}`);
            }
            if (response.urls.default) {
              console.log(`  Default: ${response.urls.default}`);
            }
            if (response.aliases && response.aliases.length > 0) {
              console.log(`\nAliases: ${response.aliases.join(', ')}`);
            }
            if (response.failed && response.failed.length > 0) {
              console.log(`\nFailed files: ${response.failed.join(', ')}`);
            }

            resolve(response);
          } catch (e) {
            console.log('Response:', data);
            resolve({ rawData: data });
          }
        } else {
          console.error(`\n✗ Upload failed with status ${res.statusCode}`);
          console.error('Response:', data);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    request.on('error', (err) => {
      console.error('Request error:', err.message);
      reject(err);
    });
  });
}

/**
 * Upload all coverage files in batches
 */
async function uploadCoverageFiles() {
  console.log('Starting coverage file upload test...');
  console.log(`API URL: ${API_BASE_URL}`);
  console.log(`Repository: ${REPOSITORY}`);
  console.log(`Commit SHA: ${COMMIT_SHA}`);
  console.log(`Branch: ${BRANCH}`);
  console.log(`Coverage directory: ${COVERAGE_DIR}`);
  console.log('---');

  // Check if coverage directory exists
  if (!fs.existsSync(COVERAGE_DIR)) {
    console.error(`Error: Coverage directory not found at ${COVERAGE_DIR}`);
    console.error('Please run "pnpm test" first to generate coverage files.');
    process.exit(1);
  }

  // Find all files recursively
  const allFiles = findFilesRecursively(COVERAGE_DIR);
  console.log(`\nFound ${allFiles.length} files to upload`);

  if (allFiles.length === 0) {
    console.error('No files found in coverage directory');
    process.exit(1);
  }

  // Split files into batches
  const batches = [];
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    batches.push(allFiles.slice(i, i + BATCH_SIZE));
  }

  console.log(`Split into ${batches.length} batch(es) of up to ${BATCH_SIZE} files each`);

  // Upload each batch
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < batches.length; i++) {
    try {
      const result = await uploadBatch(batches[i], i + 1, batches.length);
      results.push(result);
      successCount++;
    } catch (err) {
      console.error(`\nBatch ${i + 1} failed:`, err.message);
      failureCount++;
      results.push({ error: err.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('UPLOAD SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total files: ${allFiles.length}`);
  console.log(`Total batches: ${batches.length}`);
  console.log(`Successful batches: ${successCount}`);
  console.log(`Failed batches: ${failureCount}`);

  if (successCount > 0) {
    console.log('\nSuccessful deployments:');
    results.forEach((result, index) => {
      if (result.deploymentId) {
        console.log(`  Batch ${index + 1}: ${result.deploymentId} (${result.fileCount} files, ${formatBytes(result.totalSize)})`);
      }
    });
  }

  return results;
}

/**
 * Get content type based on file extension
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Run the script
uploadCoverageFiles()
  .then(() => {
    console.log('\n✓ Test completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ Test failed:', err.message);
    process.exit(1);
  });