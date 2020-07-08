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

import { ensureDir } from 'fs-extra';
import { CSR, IEnrollmentResponse, IEnrollSecretResponse } from '../../utils/data-type';
import { d, e } from '../../utils/logs';
import { SysWrapper } from '../../utils/sysWrapper';
import { BaseGenerator } from '../base';
import { ClientConfig } from '../../core/hlf/helpers';
import { Membership, UserParams } from '../../core/hlf/membership';
import { HLF_CLIENT_ACCOUNT_ROLE, MAX_ENROLLMENT_COUNT } from '../../utils/constants';
import { Peer } from '../../models/peer';
import { IEnrollmentRequest, IEnrollResponse } from 'fabric-ca-client';
import createFile = SysWrapper.createFile;
import { Utils } from '../../utils/utils';
import getPeerMspPath = Utils.getPeerMspPath;
import getPeerTlsPath = Utils.getPeerTlsPath;
import getOrganizationMspPath = Utils.getOrganizationMspPath;
import getPropertiesPath = Utils.getPropertiesPath;
import copyFile = SysWrapper.copyFile;
import getOrganizationUsersPath = Utils.getOrganizationUsersPath;
import { Organization } from '../../models/organization';
import { CertificateCsr } from '../utils/certificateCsr';
import { Network } from '../../models/network';
import { AlreadyEnrolledException } from '../../utils/exceptions/AlreadyEnrolledException';

export interface AdminCAAccount {
  name: string;
  password: string;
}

/**
 * Class responsible to generate organization keys and certificates credentials
 *
 * @author wassim.znaidi@gmail.com
 * @author ahmed.souissi@irt-systemx.fr
 */
export class OrgCertsGenerator extends BaseGenerator {
  contents = `
name: "bnc"
x-type: "hlfv1"
description: "Blockchain network composer"
version: "1.0"

client:
  organization: ${this.network.organizations[0].name}
  credentialStore:
    path: ${this.network.options.networkConfigPath}/wallets/organizations/${this.network.organizations[0].fullName}
    cryptoStore:
      path: ${this.network.options.networkConfigPath}/wallets/organizations/${this.network.organizations[0].fullName}

certificateAuthorities:
  ${this.network.organizations[0].caName}:
    url: http${this.network.organizations[0].isSecure ? 's' : ''}://${this.network.organizations[0].engineHost(this.network.organizations[0].ca.options.engineName)}:${this.network.organizations[0].ca.options.port}
    httpOptions:
      verify: false
    tlsCACerts:
      path: ${this.network.options.networkConfigPath}/organizations/peerOrganizations/${this.network.organizations[0].fullName}/msp/tlscacerts
    registrar:
      - enrollId: ${this.admin.name}
        enrollSecret: ${this.admin.password}
    caName: ${this.network.organizations[0].caName}    
 `;

  constructor(filename: string,
              path: string,
              private network: Network,
              private admin: AdminCAAccount = { name: 'admin', password: 'adminpw' }) {
    super(filename, getPropertiesPath(path));
  }

  /**
   * Build all certificates for the network to be started
   */
  async buildCertificate(): Promise<boolean> {
    try {
      // Generate connection-profile & MSP folder structure
      await this.save();
      await this.createMSPDirectories();

      // Instantiate Membership instance
      d('Initiate CA Client services');
      const orgMspId = this.network.organizations[0].mspName;
      const config: ClientConfig = {
        networkProfile: this.filePath,
        admin: {
          name: this.admin.name,
          secret: this.admin.password
        }
      };
      const membership = new Membership(config);
      await membership.initCaClient(this.network.organizations[0].caName);
      d('Initiate CA Client services done !!!');

      // Generate & store admin certificate
      d('Enroll CA Registrar');
      await this._generateCAAdminOrgMspFiles(membership, orgMspId);
      d('Enroll CA Registrar done !!!');

      // copy ca tls certs if secure enabled
      const orgMspPath = getOrganizationMspPath(this.network.options.networkConfigPath, this.network.organizations[0]);
      const fromTlsCaCerts = `${this.network.options.networkConfigPath}/organizations/fabric-ca/${this.network.organizations[0].name}/crypto/ca-cert.pem`;
      membership.setCacerts(fromTlsCaCerts);
      if(this.network.organizations[0].isSecure) {
        const toFile = `${this.network.options.networkConfigPath}/organizations/peerOrganizations/${this.network.organizations[0].fullName}/tlsca/tlsca.${this.network.organizations[0].fullName}-cert.pem`;
        await copyFile(fromTlsCaCerts, toFile);
      }

      d('Start register & enroll organization admin');
      const orgAdminEnrollment = await this._generateAdminOrgFiles(this.network.organizations[0], membership, orgMspId);
      const {
        key: orgAdminKey,
        certificate: orgAdminCertificate,
        rootCertificate: orgAdminRootCertificate
      } = orgAdminEnrollment.enrollment;

      // Store generated files
      const organizationUserPath = getOrganizationUsersPath(this.network.options.networkConfigPath, this.network.organizations[0]);
      const mspAdminPath = `${organizationUserPath}/Admin@${this.network.organizations[0].fullName}/msp`;
      await createFile(`${mspAdminPath}/cacerts/ca.${this.network.organizations[0].fullName}-cert.pem`, orgAdminRootCertificate);
      await createFile(`${mspAdminPath}/keystore/priv_sk`, orgAdminKey.toBytes());
      await createFile(`${mspAdminPath}/signcerts/Admin@${this.network.organizations[0].fullName}-cert.pem`, orgAdminCertificate);
      if(this.network.organizations[0].isSecure) {
        await copyFile(fromTlsCaCerts, `${mspAdminPath}/tlscacerts/tlsca.${this.network.organizations[0].fullName}-cert.pem`);
        await copyFile(fromTlsCaCerts, `${orgMspPath}/tlscacerts/tlsca.${this.network.organizations[0].fullName}-cert.pem`);
      }
      d('Register & enroll organization admin dne !!!');

      d('Create Organization MSP');
      await createFile(`${orgMspPath}/cacerts/ca.${this.network.organizations[0].fullName}-cert.pem`, orgAdminRootCertificate);
      await createFile(`${orgMspPath}/admincerts/Admin@${this.network.organizations[0].fullName}-cert.pem`, orgAdminCertificate);
      await this.generateConfigOUFile(`${orgMspPath}/config.yaml`);

      // generate NodeOU & enroll & store peer crypto credentials
      d('Start register & enroll Organization peers...');
      for (const peer of this.network.organizations[0].peers) {
        const peerMspPath = getPeerMspPath(this.network.options.networkConfigPath, this.network.organizations[0], peer);

        // get peer csr
        const certificateCsr = new CertificateCsr(this.network);
        const csr = await certificateCsr.generateCsrHost(peer);

        const peerEnrollment = await this._generatePeerMspFiles(peer, membership, orgMspId, csr);
        const peerCertificate = peerEnrollment.enrollment.certificate;
        const peerKeyPem =  csr ? csr.key : peerEnrollment.enrollment.key.toBytes();

        // Store all generated files
        await createFile(`${peerMspPath}/admincerts/Admin@${this.network.organizations[0].fullName}-cert.pem`, orgAdminCertificate);
        await createFile(`${peerMspPath}/cacerts/ca.${this.network.organizations[0].fullName}-cert.pem`, orgAdminRootCertificate);
        await createFile(`${peerMspPath}/keystore/priv_sk`, peerKeyPem);
        await createFile(`${peerMspPath}/signcerts/${peer.name}.${this.network.organizations[0].fullName}-cert.pem`, peerCertificate);

        // Generate TLS if it'w enabled
        if(this.network.organizations[0].isSecure) {
          await copyFile(fromTlsCaCerts, `${peerMspPath}/tlscacerts/tlsca.${this.network.organizations[0].fullName}-cert.pem`);

          try {
            const peerTlsEnrollment = await this._generatePeerTlsFiles(peer, membership, peerEnrollment.secret, csr);
            const {
              certificate: peerTlsCertificate,
              rootCertificate: peerTlsRootCertificate
            } = peerTlsEnrollment;
            const peerTlsKey = csr ? csr.key : peerTlsEnrollment.key.toBytes();

            const peerTlsPath = getPeerTlsPath(this.network.options.networkConfigPath, this.network.organizations[0], peer);
            await createFile(`${peerTlsPath}/ca.crt`, peerTlsRootCertificate);
            await createFile(`${peerTlsPath}/server.crt`, peerTlsCertificate);
            await createFile(`${peerTlsPath}/server.key`, peerTlsKey);
          } catch(er) {
            if(er instanceof AlreadyEnrolledException) {
              e(`Peer ${peer.name}.${this.network.organizations[0].fullName} found on the wallet - no secret available for tls, continue...`);
              continue;
            }

            throw er;
          }
        }
      }
      d('Register & Enroll Organization peers done !!!');

      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }

  /**
   * Create folder needed for the MSP configuration for entities (user, peer, orderer)
   */
  async createMSPDirectories(): Promise<boolean> {
    try {
      const basePeerPath = `${this.network.options.networkConfigPath}/organizations/peerOrganizations/${this.network.organizations[0].fullName}/peers`;

      // create base peer
      await ensureDir(basePeerPath);

      //create the tlsca folder
      await ensureDir(`${this.network.options.networkConfigPath}/organizations/peerOrganizations/${this.network.organizations[0].fullName}/tlsca`);

      // create msp folder for every peer
      for (let peer of this.network.organizations[0].peers) {
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/tls`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/admincerts`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/cacerts`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/intermediatecerts`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/crls`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/keystore`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/signcerts`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/tlscacerts`);
        await SysWrapper.createFolder(`${basePeerPath}/${peer.name}.${this.network.organizations[0].fullName}/msp/tlsintermediatecerts`);
      }

      // create organization msp folder
      const organizationMspPath = getOrganizationMspPath(this.network.options.networkConfigPath, this.network.organizations[0]);
      await SysWrapper.createFolder(`${organizationMspPath}`);
      await SysWrapper.createFolder(`${organizationMspPath}/admincerts`);
      await SysWrapper.createFolder(`${organizationMspPath}/cacerts`);
      await SysWrapper.createFolder(`${organizationMspPath}/tlscacerts`);

      // create user admin folder
      const organizationUserPath = getOrganizationUsersPath(this.network.options.networkConfigPath, this.network.organizations[0]);
      await SysWrapper.createFolder(`${organizationUserPath}`);
      await SysWrapper.createFolder(`${organizationUserPath}/${this.network.organizations[0].adminUserFull}`);
      await SysWrapper.createFolder(`${organizationUserPath}/${this.network.organizations[0].adminUserFull}/msp`);
      await SysWrapper.createFolder(`${organizationUserPath}/${this.network.organizations[0].adminUserFull}/msp/cacerts`);
      await SysWrapper.createFolder(`${organizationUserPath}/${this.network.organizations[0].adminUserFull}/msp/keystore`);
      await SysWrapper.createFolder(`${organizationUserPath}/${this.network.organizations[0].adminUserFull}/msp/signcerts`);
      await SysWrapper.createFolder(`${organizationUserPath}/${this.network.organizations[0].adminUserFull}/msp/tlscacerts`);

      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }

  /**
   * File defining NoeOU configuration
   * @param filePath
   */
  async generateConfigOUFile(filePath: string): Promise<boolean> {
    const content = `
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/ca.${this.network.organizations[0].fullName}-cert.pem
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/ca.${this.network.organizations[0].fullName}-cert.pem
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/ca.${this.network.organizations[0].fullName}-cert.pem
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/ca.${this.network.organizations[0].fullName}-cert.pem
    OrganizationalUnitIdentifier: orderer
        `;

    try {
      await createFile(filePath, content);
      return true;
    } catch (err) {
      e(err);
      return false;
    }
  }

  /**
   * Generate MSP files for the CA Admin
   * @param membership
   * @param mspId
   * @private
   */
  async _generateCAAdminOrgMspFiles(membership: Membership, mspId: string): Promise<IEnrollResponse> {
    try {
      // Generate & store admin certificate
      const adminEnrollment: IEnrollResponse = await membership.enrollCaAdmin(mspId);

      d(`The admin account is enrolled (${!!adminEnrollment})`);

      return adminEnrollment;
    } catch (err) {
      e(err);
      return null;
    }
  }

  /**
   * Generate the MSP Files for the selected peer
   * Generate and store the NodeOU's files into peer MSP Path
   * @param peer
   * @param membership
   * @param mspId
   * @param csr
   * @private
   */
  private async _generatePeerMspFiles(peer: Peer, membership: Membership, mspId: string, csr?: CSR): Promise<IEnrollSecretResponse> {
    try {
      // add config.yaml file
      await this.generateConfigOUFile(`${getPeerMspPath(this.network.options.networkConfigPath, this.network.organizations[0], peer)}/config.yaml`);

      // enroll & store peer crypto credentials
      const params: UserParams = {
        enrollmentID: `${peer.name}.${this.network.organizations[0].fullName}`,
        enrollmentSecret: `${peer.name}pw`,
        role: HLF_CLIENT_ACCOUNT_ROLE.peer,
        maxEnrollments: MAX_ENROLLMENT_COUNT,
        affiliation: ''
      };
      const peerEnrollmentResponse = await membership.addUser(params, mspId, csr);
      d(`Peer ${peer.name} is enrolled successfully`);
      return peerEnrollmentResponse;
    } catch (err) {
      e(`Error enrolling the peer ${peer.name}`);
      e(err);
      throw err;
    }
  }

  /**
   * Generate the TLS Files for the selected peer
   * Generate and store the NodeOU's files into peer MSP Path
   * @param peer
   * @param membership
   * @param secret
   * @param csr
   * @private
   */
  private async _generatePeerTlsFiles(peer: Peer, membership: Membership, secret: string, csr?: CSR): Promise<IEnrollmentResponse> {
    try {
      // check if secret available
      if(!secret) {
        throw new AlreadyEnrolledException('error generating tls certificate -- missing secret');
      }

      // enroll & store peer crypto credentials
      const request: IEnrollmentRequest = {
        enrollmentID: `${peer.name}.${this.network.organizations[0].fullName}`,
        enrollmentSecret: secret,
        profile: 'tls',
      };
      const peerTlsEnrollment = await membership.enrollTls(request, csr);
      d(`Peer TLS ${peer.name} is enrolled successfully`);

      return peerTlsEnrollment;
    } catch (err) {
      e(`Error tls enrolling the peer ${peer.name}`);
      e(err);
      throw err;
    }
  }

  /**
   * Generate the MSP file for the organization admin
   * @param organization
   * @param membership
   * @param mspId
   * @private
   */
  private async _generateAdminOrgFiles(organization: Organization, membership: Membership, mspId: string): Promise<IEnrollSecretResponse> {
    try {
      const organizationUserPath = getOrganizationUsersPath(this.network.options.networkConfigPath, this.network.organizations[0]);
      const mspAdminPath = `${organizationUserPath}/${this.network.organizations[0].adminUserFull}/msp`;

      // add config.yaml file
      await this.generateConfigOUFile(`${mspAdminPath}/config.yaml`);

      // enroll & store organization admin credentials
      const params: UserParams = {
        enrollmentID: `${organization.adminUser}`,
        enrollmentSecret: `${organization.adminUserPass}`,
        role: HLF_CLIENT_ACCOUNT_ROLE.admin,
        maxEnrollments: MAX_ENROLLMENT_COUNT,
        affiliation: ''
      };
      const orgAdminEnrollmentResponse = await membership.addUser(params, mspId);
      d(`Admin Organization is enrolled successfully`);

      return orgAdminEnrollmentResponse;
    } catch (err) {
      e(`Error enrolling the organization admin`);
      e(err);
      throw err;
    }
  }
}
