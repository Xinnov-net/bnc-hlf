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
import { e, l } from '../../utils/logs';
import { Utils } from '../../utils/utils';
import getDockerComposePath = Utils.getDockerComposePath;
import getArtifactsPath = Utils.getArtifactsPath;
import { ENABLE_CONTAINER_LOGGING, GENESIS_FILE_NAME } from '../../utils/constants';
import { Orderer } from '../../models/orderer';
import { Network } from '../../models/network';
import { Orchestrator } from '../../orchestrator';

/**
 * Class responsible to generate Orderer compose file
 *
 * @author wassim.znaidi@gmail.com
 */
export class DockerComposeOrdererGenerator extends BaseGenerator {
  /* docker-compose orderer template content text */
  contents = `
version: '2'

volumes:
${this.network.organizations[0].orderers
    .map(orderer => `
  ${orderer.name}.${this.network.organizations[0].domainName}:
`).join('')}  

networks:
  ${this.network.options.composeNetwork}:
    external: true

services:
${this.network.organizations[0].orderers.map(orderer => `
  ${this.network.organizations[0].ordererName(orderer)}:
    extends:
      file:   base/docker-compose-base.yaml
      service: orderer-base  
    environment:
      - ORDERER_GENERAL_LISTENPORT=${orderer.options.ports[0]}
    container_name: ${this.network.organizations[0].ordererName(orderer)}
    extra_hosts:
      - "bnc_test: 127.0.0.1"
${this.network.organizations[0].getPeerExtraHost()
      .map(peerHost => `
      - "${peerHost.name}.${this.network.organizations[0].fullName}:${this.network.organizations[0].engineHost(peerHost.options.engineName)}"
`).join('')}
${this.network.organizations[0].getOrdererExtraHost()
      .map(ordererHost => `
      - "${this.network.organizations[0].ordererName(ordererHost)}:${this.network.organizations[0].engineHost(ordererHost.options.engineName)}"
`).join('')}
    networks:
      - ${this.network.options.composeNetwork}   
    volumes:
      - ${getArtifactsPath(this.network.options.networkConfigPath)}/${GENESIS_FILE_NAME}:/var/hyperledger/orderer/orderer.genesis.block
      - ${this.network.options.networkConfigPath}/organizations/ordererOrganizations/${this.network.organizations[0].domainName}/orderers/${this.network.organizations[0].ordererName(orderer)}/msp:/var/hyperledger/orderer/msp
      - ${this.network.options.networkConfigPath}/organizations/ordererOrganizations/${this.network.organizations[0].domainName}/orderers/${this.network.organizations[0].ordererName(orderer)}/tls/:/var/hyperledger/orderer/tls
      - ${this.network.organizations[0].ordererName(orderer)}:/var/hyperledger/production/orderer
    ports:
      - ${orderer.options.ports[0]}:${orderer.options.ports[0]}
`).join('')}  
  `;

  /**
   * Constructor
   * @param filename
   * @param network
   */
  constructor(filename: string, private network: Network) {
    super(filename, getDockerComposePath(network.options.networkConfigPath));
  }

  /**
   * Create the Orderer docker compose template file
   */
  async createTemplateOrderers(): Promise<boolean> {
    try {
      await this.save();

      return true;
    } catch(err) {
      e(err);
      return false;
    }
  }

  /**
   * Start a single orderer container service
   * @param orderer selected orderer
   */
  async startOrderer(orderer: Orderer): Promise<boolean>  {
    try {
      const serviceName = `${orderer.name}.${this.network.organizations[0].domainName}`;

      l(`Starting Orderer ${serviceName}...`);

      const engine = this.network.organizations[0].getEngine(orderer.options.engineName);
      const docker = Orchestrator._getDockerEngine(engine);
      // const docker = new DockerEngine({ host: engine.options.url, port: engine.options.port });

      await docker.createNetwork({ Name: this.network.options.composeNetwork });
      await docker.composeOne(serviceName, { cwd: this.path, config: this.filename, log: ENABLE_CONTAINER_LOGGING });

      l(`Service Orderer ${serviceName} started successfully !!!`);

      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }

  /**
   * Start all orderer container within the above compose template
   */
  async startOrderers(): Promise<boolean> {
    try {
      for(const orderer of this.network.organizations[0].orderers) {
        await this.startOrderer(orderer);
      }

      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }
}
