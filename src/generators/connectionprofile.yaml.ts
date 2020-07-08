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

import { BaseGenerator } from './base';
import { e } from '../utils/logs';
import { Network } from '../models/network';

/**
 *
 * @author wassim.znaidi@gmail.com
 */
export class ConnectionProfileGenerator extends BaseGenerator {
  contents = `
version: "1.0"

channels:
  ${this.channelName}:
    orderers:
${this.network.organizations[0].orderers
    .map(orderer => `    
      - ${orderer.name}.${this.network.organizations[0].fullName}
`).join('')}      
    peers:
${this.network.organizations[0].peers
    .map(peer => `    
      ${peer.name}.${this.network.organizations[0].fullName}:
        endorsingPeer: true
        chaincodeQuery: true
        ledgerQuery: true
        eventSource: true
`).join('')}      

organizations:
  ${this.network.organizations[0].name}:
    mspid: ${this.network.organizations[0].mspName}
    peers:
${this.network.organizations[0].peers
    .map(peer => `    
      - ${peer.name}.${this.network.organizations[0].fullName}
`).join('')}      
    certificateAuthorities:
      - ${this.network.organizations[0].caName}

orderers:
${this.network.organizations[0].orderers
    .map(orderer => `    
  ${orderer.name}.${this.network.organizations[0].fullName}:
    url: grpc${this.network.organizations[0].isSecure ? 's' : ''}://localhost:${orderer.options.ports[0]}
    grpcOptions:
      ssl-target-name-override: ${orderer.name}.${this.network.organizations[0].fullName}
`).join('')}

peers:
${this.network.organizations[0].peers
    .map(peer => `    
  ${peer.name}.${this.network.organizations[0].fullName}:
    url: grpc${this.network.organizations[0].isSecure ? 's' : ''}://localhost:${peer.options.ports[0]}
    grpcOptions:
      ssl-target-name-override: ${peer.name}.${this.network.organizations[0].fullName}
      request-timeout: 120001
`).join('')}
      
certificateAuthorities:
  ${this.network.organizations[0].caName}:
     url: http://localhost:${this.network.organizations[0].ca.options.port}
     httpOptions:
       verify: false
     registrar:
       - enrollId: ${this.network.organizations[0].ca.options.user}
         enrollSecret: ${this.network.organizations[0].ca.options.password}
     caName: ${this.network.organizations[0].caName}
  `;

  /**
   * Constructor
   * @param filename the connection profile filename
   * @param path loction folder path where to store the connection profile
   * @param network
   * @param channelName the name of the channel to be added by default in connection profile
   */
  constructor(filename: string, path: string,  private network: Network, private channelName?: string) {
    super(filename, path);
  }

  /**
   * Create the Orderer docker compose template file
   */
  async createTemplateConnectionProfile(): Promise<Boolean> {
    try {
      await this.save();

      return true;
    } catch(err) {
      e(err);
      return false;
    }
  }
}
