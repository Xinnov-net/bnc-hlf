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

import { Organization } from '../models/organization';
import { Network } from '../models/network';
import { IEnrollResponse, IKey } from 'fabric-ca-client';

/**
 *
 * @author wassim.znaidi@gmail.com
 */
export class DockerComposeYamlOptions {
  networkRootPath: string;
  composeNetwork: string;
  org: Organization;
  envVars?: {
    FABRIC_VERSION?: string;
    FABRIC_CA_VERSION?: string;
    THIRDPARTY_VERSION?: string;
  };
}

export interface CSR {
  csr: string;
  key: string;
}

export interface CsrRequest {
  san: string;
  enrollmentID?: string;
}

// tslint:disable-next-line:class-name
export interface CSR_KEY {
  csr: string;
  key: any;
}

export type IEnrollmentResponse = IEnrollResponse;

export interface IEnrollSecretResponse {
  enrollment: IEnrollmentResponse;
  secret?: string;
}
