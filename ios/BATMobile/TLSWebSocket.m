#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(TLSWebSocket, RCTEventEmitter)

RCT_EXTERN_METHOD(connect:(NSString *)url fingerprint:(NSString *)fingerprint)
RCT_EXTERN_METHOD(send:(NSString *)message)
RCT_EXTERN_METHOD(close:(NSInteger)code reason:(NSString *)reason)

@end
