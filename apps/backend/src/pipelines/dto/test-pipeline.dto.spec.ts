import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MockUserDto } from './test-pipeline.dto';

describe('MockUserDto.projectRole', () => {
  it('accepts a valid ProjectRole value', async () => {
    const dto = plainToInstance(MockUserDto, { id: 'mock-user-123', projectRole: 'contributor' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a value outside the ProjectRole union', async () => {
    const dto = plainToInstance(MockUserDto, { id: 'mock-user-123', projectRole: 'superuser' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('projectRole');
  });

  it('leaves projectRole undefined when absent', async () => {
    const dto = plainToInstance(MockUserDto, { id: 'mock-user-123' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.projectRole).toBeUndefined();
  });
});
