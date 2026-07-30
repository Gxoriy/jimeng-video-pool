import { Global, Module } from '@nestjs/common';
import { EgressService } from './egress.service';
import { EgressHttpService } from '../generation/http/egress-http.service';

@Global()
@Module({
  providers: [EgressService, EgressHttpService],
  exports: [EgressService, EgressHttpService],
})
export class EgressModule {}
