import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  // 10 inscriptions par minute et par adresse IP au maximum.
  @Throttle({
    default: {
      limit: 10,
      ttl: 60000,
    },
  })
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  // 10 connexions par minute et par adresse IP au maximum.
  @Throttle({
    default: {
      limit: 10,
      ttl: 60000,
    },
  })
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }
}