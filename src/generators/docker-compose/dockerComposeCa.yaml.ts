/*
Copyright 2020 IRT SystemX

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseGenerator } from '../base';
import { DockerEngine } from '../../agents/docker-agent';
import { d, e, l } from '../../utils/logs';
import { DOCKER_CA_DELAY, DOCKER_DEFAULT } from '../../utils/constants';
import { Utils } from '../../utils/utils';
import delay = Utils.delay;
import changeOwnerShipWithPassword = Utils.changeOwnerShipWithPassword;
import changeOwnership = Utils.changeOwnership;
import getDockerComposePath = Utils.getDockerComposePath;
import { Network } from '../../models/network';

/**
 *
 * @author wassim.znaidi@gmail.com
 */
export class DockerComposeCaGenerator extends BaseGenerator {
  contents = `
version: '2'

networks:
  ${this.network.options.composeNetwork}:
    external: true

services:
  ${this.network.organizations[0].caName}:
    container_name: ${this.network.organizations[0].caName}
    image: hyperledger/fabric-ca:${this.network.options.hyperledgerCAVersion}
    command: sh -c 'fabric-ca-server start -d -b ${this.network.organizations[0].ca.options.user}:${this.network.organizations[0].ca.options.password} --port ${this.network.organizations[0].ca.options.port} --cfg.identities.allowremove'
    environment:
      - FABRIC_CA_SERVER_HOME=/tmp/hyperledger/fabric-ca/crypto
      - FABRIC_CA_SERVER_CA_NAME=${this.network.organizations[0].caName}
      - FABRIC_CA_SERVER_TLS_ENABLED=${this.network.organizations[0].isSecure}
      - FABRIC_CA_SERVER_CSR_CN=${this.network.organizations[0].caCn}
      - FABRIC_CA_SERVER_CSR_HOSTS=0.0.0.0
      - FABRIC_CA_SERVER_DEBUG=true
    ports:
      - "${this.network.organizations[0].ca.options.port}:${this.network.organizations[0].ca.options.port}"
    volumes:;
      - ${this.network.options.networkConfigPath}/organizations/fabric-ca/${this.network.organizations[0].name}:/tmp/hyperledger/fabric-ca
    networks:
      - ${this.network.options.composeNetwork}    
  `;

  /**
   *
   * @param filename
   * @param path
   * @param network
   * @param dockerEngine
   */
  constructor(filename: string,
              path: string,
              private network: Network,
              private readonly dockerEngine?: DockerEngine) {
    super(filename, getDockerComposePath(network.options.networkConfigPath));

    if (!this.dockerEngine) {
      this.dockerEngine = new DockerEngine({ host: DOCKER_DEFAULT.IP as string, port: DOCKER_DEFAULT.PORT });
    }
  }

  async startTlsCa() {
    try {
      await this.dockerEngine.composeOne(`${this.network.organizations[0].caName}`, { cwd: this.path, config: this.filename });
      await changeOwnership(`${this.network.options.networkConfigPath}/${this.network.organizations[0].name}`);
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
      const caIsRunning = await this.dockerEngine.doesContainerExist(`${this.network.organizations[0].caName}`);
      if (caIsRunning) {
        l('CA container is already running');
        return true;
      }

      await this.dockerEngine.composeOne(`${this.network.organizations[0].caName}`, { cwd: this.path, config: this.filename });

      // Check the container is running
      await delay(DOCKER_CA_DELAY);
       const isCaRunning = await this.dockerEngine.doesContainerExist(`${this.network.organizations[0].caName}`);
       if(!isCaRunning) {
         d('CA container not yet running - waiting more');
         await delay(DOCKER_CA_DELAY * 2);
       }
      d('CA running');

      // check if CA crypto generated
      await changeOwnerShipWithPassword(`${this.network.options.networkConfigPath}`);
      // await this.changeOwnerShipWithPassword(`${this.options.networkRootPath}/organizations/fabric-ca/${this.network.organizations[0].name}`);
      // await this.changeOwnership(`${this.options.networkRootPath}/organizations/fabric-ca/${this.network.organizations[0].name}`);

      d('Folder OwnerShip updated successfully');

      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }

  /**
   * Stop the CA container.
   */
  async stopOrgCa(): Promise<Boolean> {
    try {
      const caIsRunning = await this.dockerEngine.doesContainerExist(`${this.network.organizations[0].caName}`);
      if (!caIsRunning) {
        l(`CA ${this.network.organizations[0].caName} container is not running`);
        return true;
      }

      return await this.dockerEngine.stopContainer(`${this.network.organizations[0].caName}`, true);
    } catch (err) {
      e(err);
      return false;
    }
  }
}
