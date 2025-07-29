import { PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-blog.dto';

export class UpdatePostDto extends PartialType(CreatePostDto) {}
