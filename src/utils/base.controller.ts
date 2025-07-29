export abstract class BaseController {
  protected success(data: any = [], message = ''): any {
    return {
      status: 'success',
      message,
      data,
    };
  }
}
