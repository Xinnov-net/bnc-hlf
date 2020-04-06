import * as sudo from 'sudo-prompt';
import { exec } from 'shelljs';
import { BaseGenerator } from '../base';
import { DockerComposeYamlOptions } from '../../utils/data-type';
import { DockerEngine } from '../../agents/docker-agent';
import { e, l } from '../../utils/logs';
import * as chalk from 'chalk';
import { BNC_TOOL_NAME, DOCKER_DEFAULT } from '../../utils/constants';

export class DockerComposeCaGenerator extends BaseGenerator {
  contents = `
version: '2'

networks:
  ${this.options.composeNetwork}:
    external: true

services:
  rca.${this.options.org.name}:
    container_name: rca.${this.options.org.name}
    image: hyperledger/fabric-ca
    command: sh -c 'fabric-ca-server start -d -b rca-${this.options.org.name}-admin:rca-${this.options.org.name}-adminpw --port 7054 --cfg.identities.allowremove'
    environment:
      - FABRIC_CA_SERVER_HOME=/tmp/hyperledger/fabric-ca/crypto
      - FABRIC_CA_SERVER_CA_NAME=rca.${this.options.org.name}
      - FABRIC_CA_SERVER_TLS_ENABLED=true
      - FABRIC_CA_SERVER_CSR_CN=ca.tls
      - FABRIC_CA_SERVER_CSR_HOSTS=0.0.0.0
      - FABRIC_CA_SERVER_DEBUG=true
    ports:
      - "7054:7054"
    volumes:
      - ${this.options.networkRootPath}/organizations/fabric-ca/${this.options.org.name}:/tmp/hyperledger/fabric-ca
    networks:
      - ${this.options.composeNetwork}    
  `;

  constructor(filename: string, path: string, private options?: DockerComposeYamlOptions, private readonly dockerEngine?: DockerEngine) {
    super(filename, path);
    if (!this.dockerEngine) {
      this.dockerEngine = new DockerEngine({ host: DOCKER_DEFAULT.IP as string, port: DOCKER_DEFAULT.PORT });
    }
  }

  async startTlsCa() {
    try {
      await this.dockerEngine.composeOne(`ca.${this.options.org.name}.tls`, { cwd: this.path, config: this.filename });
      await this.changeOwnership(`${this.options.networkRootPath}/${this.options.org.name}`);
    } catch (err) {
      e(err);
    }
  }

  /**
   * Start the CA container.
   * If already one exists stop it and restart the new one
   */
  async startOrgCa(): Promise<Boolean> {
    try {
      const caIsRunning = await this.dockerEngine.doesContainerExist(`rca.${this.options.org.name}`);
      if (caIsRunning) {
        l('CA container is already running');
        return true;
      }

      await this.dockerEngine.composeOne(`rca.${this.options.org.name}`, { cwd: this.path, config: this.filename });

      await this.changeOwnerShipWithPassword(`${this.options.networkRootPath}`);
      // await this.changeOwnerShipWithPassword(`${this.options.networkRootPath}/organizations/fabric-ca/${this.options.org.name}`);
      // await this.changeOwnership(`${this.options.networkRootPath}/organizations/fabric-ca/${this.options.org.name}`);

      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }

  private changeOwnership(folder: string) {
    const options = {
      name: BNC_TOOL_NAME
    };

    const command = `chown -R 1001:1001 ${folder}`;

    return new Promise((resolved, rejected) => {
      sudo.exec(command, options, (error, stdout, stderr) => {
        if (error) {
          rejected(error);
        }

        if (stderr) {
          console.error(chalk.red(stderr));
          e(stderr);
        }

        resolved(true);
      });
    });
  }

  private changeOwnerShipWithPassword(folder: string, password = 'wassim'): Promise<Boolean> {
    const command = `echo 'wassim' | sudo -kS chown -R $USER:$USER ${folder}`;

    return new Promise((resolved, rejected) => {
      exec(command, {silent: true}, function(code, stdout, stderr) {

        if(stderr) {
          e(stderr);
        }

        return code === 0 ? resolved() : rejected();
      });
    });
  }
}
