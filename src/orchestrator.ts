import { join } from 'path';
import { l, d, e } from './utils/logs';
import { DeploymentParser } from './parser/deploymentParser';
import { NetworkCleanShGenerator, NetworkCleanShOptions } from './generators/networkClean.sh';
import { ConfigurationValidator } from './parser/validator/configurationValidator';
import { DockerComposeYamlOptions } from './utils/data-type';
import { DownloadFabricBinariesGenerator } from './generators/utils/downloadFabricBinaries';
import { Network } from './models/network';
import { DockerEngine } from './agents/docker-agent';
import { GenesisParser } from './parser/geneisParser';
import { ConfigtxYamlGenerator } from './generators/configtx.yaml';
import {Caclient} from './core/hlf/ca_client';
import { DockerComposeCaGenerator } from './generators/crypto/dockerComposeCa.yaml';
import { CreateOrgCertsShGenerator } from './generators/crypto/createOrgCerts.sh';
import { SysWrapper } from './utils/sysWrapper';
import createFolder = SysWrapper.createFolder;

export class Orchestrator {
  networkRootPath = './hyperledger-fabric-network';

  async initNetwork(configFilePath: string) {
    // const homedir = require('os').homedir();
    // const path = join(homedir, this.networkRootPath);

    l('Validate input configuration file');
    const validator = new ConfigurationValidator();
    const isValid = validator.isValidDeployment(configFilePath);

    l('Start parsing the blockchain configuration file');
    let configParse = new DeploymentParser(configFilePath);
    const organizations = await configParse.parse();

    l('Finishing parsing the blockchain configuration file');
  }

  async generateGenesis(configGenesisFilePath: string) {
    const homedir = require('os').homedir();
    const path = join(homedir, this.networkRootPath);

    l('Parsing genesis input file');
    const validator = new ConfigurationValidator();
    const isValid = validator.isValidGenesis(configGenesisFilePath);
    if (!isValid) {
      e('Genesis configuration input file is invalid');
      return;
    }
    l('Input genesis file validated');

    l('Start parsing genesis input file');
    const parser = new GenesisParser(configGenesisFilePath);
    const network: Network = await parser.parse();
    l('Genesis input file parsed');

    l('Start generating configtx.yaml file');
    const configTx = new ConfigtxYamlGenerator('configtx.yaml', path, network);
    await configTx.save();
    l('Configtx.yaml file saved');

    d('Testing debugging genesis generation');
  }

  async validateAndParse(configFilePath: string, skipDownload = false) {
    l('[Start] Start parsing the blockchain configuration file');
    l('Validate input configuration file');
    const validator = new ConfigurationValidator();
    const isValid = validator.isValidDeployment(configFilePath);

    if (!isValid) {
      e('Configuration file is invalid');
      return;
    }
    l('Configuration file valid');

    let configParse = new DeploymentParser(configFilePath);
    // TODO config parse should return the network instance and not an array of organizations
    const organizations = await configParse.parse();
    l('[End] Blockchain configuration files parsed');

    // Generate dynamically crypto
    const homedir = require('os').homedir();
    // const path = organizations[0].templateFolder ? organizations[0].templateFolder : join(homedir, this.networkRootPath);
    const path = join(homedir, this.networkRootPath);
    await createFolder(path);

    const options: DockerComposeYamlOptions = {
      networkRootPath: path,
      composeNetwork: 'bnc_network',
      org: organizations[0],
      envVars: {
        FABRIC_VERSION: '2.0.0',
        FABRIC_CA_VERSION: '1.4.4',
        THIRDPARTY_VERSION: '0.4.18'
      }
    };

    if (!skipDownload) {
      l('[Start] Download fabric binaries...');
      const downloadFabricBinariesGenerator = new DownloadFabricBinariesGenerator('downloadFabric.sh', path, options);
      await downloadFabricBinariesGenerator.save();
      await downloadFabricBinariesGenerator.run();
      l('[End] Ran Download fabric binaries');
    }

    // create network
    const engine = new DockerEngine({ host: '127.0.0.1', port: 2375 });
    const isAlive = await engine.isAlive();
    if (!isAlive) {
      l('Docker engine is down. Please check you docker server');
      return;
    }
    l('Your docker engine is running...');
    l('[Start] Create docker network (bnc-network)');
    await engine.createNetwork({ Name: options.composeNetwork });
    l('[End] Docker network (bnc-network) created');

    // create ca
    let dockerComposeCA = new DockerComposeCaGenerator('docker-compose-ca.yaml', path, options, engine);
    l('[Start] Starting ORG CA docker container...');
    await dockerComposeCA.save();
    await dockerComposeCA.startOrgCa();
    l('[End] Ran Root CA docker container...');

    const createCaShGenerator = new CreateOrgCertsShGenerator('createCerts.sh', path, options);
    l('[Start] Creating certificates');
    await createCaShGenerator.buildCertificate();
    l('[End] Certificates created');

    // const dockerComposePeer = new DockerComposePeerGenerator('docker-compose-peer.yaml', path, options, engine);
    // await dockerComposePeer.save();
  }

  public async cleanDocker(rmi: boolean) {
    const options = new NetworkCleanShOptions();
    options.removeImages = rmi;

    let networkClean = new NetworkCleanShGenerator('clean.sh', 'na', options);
    await networkClean.run();

    l('************ Success!');
    l('Environment cleaned!');
  }

  public async enroll(id, secret, mspID,caInfo, walletDirectoryName, ccpPath) {
    const caclient = new Caclient(caInfo, walletDirectoryName, ccpPath);
    await caclient.enroll(id, secret, mspID);
  }

  public async registerUser(id, secret, affiliation, mspID, caInfo, walletDirectoryName, ccpPath) {

    const caclient = new Caclient(caInfo, walletDirectoryName, ccpPath);
    await caclient.registerUser (id, secret, affiliation, mspID);
  }

  public async fetchIdentity(id,caInfo, walletDirectoryName, ccpPath) {
    const caclient = new Caclient(caInfo, walletDirectoryName, ccpPath);
    await caclient.fetchIdentity(id);
  }

  public async deleteIdentity(id,caInfo, walletDirectoryName, ccpPath) {
    const caclient = new Caclient(caInfo, walletDirectoryName, ccpPath);
    await caclient.deleteIdentity(id);
  }
}
