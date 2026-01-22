import { API } from 'homebridge';
import { PLATFORM_NAME } from './platform';
import { HegelH590Platform } from './platform';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, HegelH590Platform);
};