const path = require('path');
const core = require('@actions/core');
const tmp = require('tmp');
const fs = require('fs');

async function run() {
  try {
    // Get inputs
    const taskDefinitionFile = core.getInput('task-definition', { required: true });
    const containerName = core.getInput('container-name', { required: true });
    const imageURI = core.getInput('image', { required: true });

    const environmentVariables = core.getInput('environment-variables', { required: false });
    const secretVariables = core.getInput('secrets', { required: false });

    // Parse the task definition
    const taskDefPath = path.isAbsolute(taskDefinitionFile) ?
      taskDefinitionFile :
      path.join(process.env.GITHUB_WORKSPACE, taskDefinitionFile);
    if (!fs.existsSync(taskDefPath)) {
      throw new Error(`Task definition file does not exist: ${taskDefinitionFile}`);
    }
    const taskDefContents = require(taskDefPath);

    // Insert the image URI
    if (!Array.isArray(taskDefContents.containerDefinitions) || taskDefContents.containerDefinitions.length === 0) {
      throw new Error('Invalid task definition format: containerDefinitions section is not present or is not an array');
    }
    let containerDef = taskDefContents.containerDefinitions.find(function(element) {
      return element.name === containerName;
    });
    if (!containerDef && taskDefContents.containerDefinitions.length === 1 && taskDefContents.containerDefinitions[0].name === undefined) {
      containerDef = taskDefContents.containerDefinitions[0];
      containerDef.name = containerName;
    }
    if (!containerDef) {
      throw new Error('Invalid task definition: Could not find container definition with matching name');
    }
    containerDef.image = imageURI;

    if (environmentVariables) {

      // If environment array is missing, create it
      if (!Array.isArray(containerDef.environment)) {
        containerDef.environment = [];
      }

      // Get pairs by splitting on newlines
      environmentVariables.split('\n').forEach(function (line) {
        // Trim whitespace
        const trimmedLine = line.trim();
        // Skip if empty
        if (trimmedLine.length === 0) { return; }
        // Split on =
        const separatorIdx = trimmedLine.indexOf("=");
        // If there's nowhere to split
        if (separatorIdx === -1) {
            throw new Error(`Cannot parse the environment variable '${trimmedLine}'. Environment variable pairs must be of the form NAME=value.`);
        }
        // Build object
        const variable = {
          name: trimmedLine.substring(0, separatorIdx),
          value: trimmedLine.substring(separatorIdx + 1),
        };

        // Search container definition environment for one matching name
        const variableDef = containerDef.environment.find((e) => e.name == variable.name);
        if (variableDef) {
          // If found, update
          variableDef.value = variable.value;
        } else {
          // Else, create
          containerDef.environment.push(variable);
        }
      })
    }

    // inject secrets into task definition, use valueFrom to reference SSM parameters
    if(secretVariables) {
      containerDef.secrets = containerDef.secrets || [];
      const secretLines = secretVariables.split('\n');

      for (const line of secretLines) {
        const trimmedLine = line.trim();

        if (trimmedLine.length === 0) {
          continue;
        }

        const separatorIdx = trimmedLine.indexOf("=");
        if (separatorIdx === -1) {
          throw new Error(`Cannot parse the secret variable '${trimmedLine}'. Secret variable pairs must be of the form NAME=value.`);
        }

        const secret = {
          name: trimmedLine.substring(0, separatorIdx).trim(),
          valueFrom: trimmedLine.substring(separatorIdx + 1).trim(),
        };

        // Search container definition environment for one matching name
        const secretDef = containerDef.secrets.find((e) => e.name === secret.name);

        if (secretDef) {
          secretDef.valueFrom = secret.valueFrom;
        } else {
          containerDef.secrets.push(secret);
        }
      }
    }

    // Write out a new task definition file
    var updatedTaskDefFile = tmp.fileSync({
      tmpdir: process.env.RUNNER_TEMP,
      prefix: 'task-definition-',
      postfix: '.json',
      keep: true,
      discardDescriptor: true
    });
    const newTaskDefContents = JSON.stringify(taskDefContents, null, 2);
    fs.writeFileSync(updatedTaskDefFile.name, newTaskDefContents);
    core.setOutput('task-definition', updatedTaskDefFile.name);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
    run();
}
