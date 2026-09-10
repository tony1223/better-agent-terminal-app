#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FileExporter, NSObject)

RCT_EXTERN_METHOD(saveBase64:(NSString *)dataBase64
                  fileName:(NSString *)fileName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
