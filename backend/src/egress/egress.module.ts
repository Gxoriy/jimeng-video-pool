import { Global, Module } from '@nestjs/common';
import { EgressService } from './egress.service';
import { EgressHttpService } from './egress-http.service';

@Global()
@Module({
  providers: [EgressService, EgressHttpService],
  exports: [EgressService, EgressHttpService],
})
export class EgressModule {}
