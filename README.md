서버리스에서 VPC 내부로 배포하는 방법에 대해서 알아보려고 한다. 현재 진행 중인 프로젝트는 빠르고 간단하게 홍보용으로 만들고 있는 프로젝트라, 별다른 옵션 없이 퍼블릭하게 오픈된 API를 만들어놓고 개발 중이다. 그런데, 개발 서버를 분리해서 일정 기간동안 유지 보수 하면서 배포도 몇 번 더 해야 할 필요가 있어서 내부 VPC에 배포하는 방법을 확인해보려고 한다. 추가적으로, VPC 내부로 배포하게 되면 S3와 DynamoDB에 접근하기 위해 NAT Gateway 또는 VPC Endpoint를 만들어줘야 한다. 이번 글에서는 NAT Gateway를 설정해주는 걸 해볼 것이다.

## 사전 준비

핵심에 집중하기 위해서, 데모는 아래와 같은 준비가 되어있다고 가정한다.

- 프라이빗 서브넷을 가지고 있는 VPC
- `serverless create -t aws-nodejs-typescript` 명령어로 만들어진 샘플 앱 (`region`은 한국)

위 샘플 앱에서 `region` 설정만 해준 다음 바로 배포를 하게 되면 VPC 설정이 안되고, 오픈된 API Gateway가 구성되게 되어있다. 현재 상황은 배포가 완료되어서 API Gateway로 접근해서 확인할 수 있는 상황이다.

## 초기 앱 설정

일단 간단하게 리소스를 설정해주고 DynamoDB와 S3에 접근하는 코드를 만들어보자. `aws-sdk`를 설치해준 다음 `handler.ts` 파일에 s3의 목록을 읽어오는 것과 만들어놓은 데모 테이블을 스캔하는 코드를 작성했다. 아래는 `serverless.yml` 파일이다.

```yml
service:
  name: serverless-sample-api

custom:
  webpack:
    webpackConfig: ./webpack.config.js
    includeModules: true

plugins:
  - serverless-webpack

resources:
  Resources:
    demoBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: vpc-demo-bucket

    demoTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: vpc-demo-table
        AttributeDefinitions:
          - AttributeName: id
            AttributeType: S
        KeySchema:
          - AttributeName: id
            KeyType: HASH
        ProvisionedThroughput:
          ReadCapacityUnits: 1
          WriteCapacityUnits: 1

provider:
  name: aws
  runtime: nodejs12.x
  region: ap-northeast-2
  apiGateway:
    minimumCompressionSize: 1024
  environment: ${file(env.yml)}
  iamRoleStatements:
    - Effect: Allow
      Action: s3:ListBucket
      Resource:
        - "arn:aws:s3:::vpc-demo-bucket"

    - Effect: Allow
      Action: dynamodb:Scan
      Resource:
        - "arn:aws:dynamodb:ap-northeast-2:*:table/vpc-demo-table"

functions:
  hello:
    handler: handler.hello
    events:
      - http:
          method: get
          path: hello
```

`env.yml` 파일에는 `AWS_ACCESS_KEY`와 `AWS_SECRET_KEY`를 담고 있는데, `iamRoleStatements`에 적힌 권한으로 인해, 사실상 `aws-sdk`의 `config.update({...})` 부분이 없었어도 돌아갔을 것 같다. 우선 이렇게 설정을 해주고 다시 배포를 해줬다. Bucket과 Table에 데이터를 하나씩 넣어주고 작동해서 확인해봤다. 이제 대충 VPC없는 환경에서의 일반 앱의 구조처럼 배포가 된 상태이다.

## VPC 설정

`serverless.yml`에서 관리하는 모든 함수들에 대해서 VPC 설정을 해줄 수도 있고 특정 함수에 대해서만 VPC 설정을 해줄 수도 있다. 기본적으로 `vpc`라는 프로퍼티를 추가해주면 되는데, 이 프로퍼티는 `securityGroupIds`와 `subnetIds`라는 배열 형태의 속성을 갖는다. 공식 문서에 나온 예시는 아래와 같다.

```yml
# serverless.yml
service: service-name
provider:
  name: aws
  vpc:
    securityGroupIds:
      - securityGroupId1
      - securityGroupId2
    subnetIds:
      - subnetId1
      - subnetId2

functions:
  hello: # this function will overwrite the service level vpc config above
    handler: handler.hello
    vpc:
      securityGroupIds:
        - securityGroupId1
        - securityGroupId2
      subnetIds:
        - subnetId1
        - subnetId2
  users: # this function will inherit the service level vpc config above
    handler: handler.users
```

예시의 주석에 설명 되어있듯, 세부적인 옵션일수록 우선순위가 높게 적용된다. 전체에 해당하는 옵션은 세부적인 함수에 적용되는 옵션보다 우선순위가 낮다.

그렇다면 우리 프로젝트에도 적용해보자. 아래 env.yml에서는 프라이빗 서브넷 아이디를 값으로 두 개 넣어주고, default vpc securitygroup 아이디로 설정해줬다.

```yml
#...
vpc:
  subnetIds:
    - ${file(env.yml):SBNID1}
    - ${file(env.yml):SBNID2}
  securityGroupIds:
    - ${file(env.yml):SCGID1}
#...
```

위와같이 설정 해주고 다시 배포를 하면, 설정해준 VPC의 서브넷에 배포가 되고, 다시 같은 엔드포인트로 접속했을 때 타임아웃이 뜬다.

## NAT Gateway 설정

연결과 관련해서 처음엔 상당히 당황스러운 경험이 있었다. [문서](https://serverless.com/framework/docs/providers/aws/guide/functions#vpc-configuration)에서 확인했을 때는, VPC 내부에 람다를 설정했을 때 S3, DynamoDB와 같은 서비스에는 람다와 같은 서비스를 VPC 내부에서 사용하거나, 서비스의 기본 설정이 VPC인 서비스는 다른 AWS 리소스와 통신하기 위해 VPC Endpoint를 설정 해줘야 한다고 되어 있었는데, 로컬에서 람다 작동을 확인해보기 위해 NAT Gateway만 사용했더니 DynamoDB, S3가 모두 정상 작동했다. 이유를 잘 모르겠어서 AWSKRUG 그룹에 상황과 함께 질문을 드렸는데 정말 친절하신 고수님께서 추측을 해주셨는데 그 이유는 다음과 같다.

람다같은 서비스를 VPC로 설정해서 쓰거나, 서비스의 기본 설정이 VPC인 경우 다른 AWS 리소스와 통신을 위해서 VPC Endpoint 설정을 해줘야 한다. 다만, 만들어주는 이유는 "통신"을 하기 위함이기 때문에 NAT Gateway를 통해 VPC를 Public 망으로 나갈 수 있는 경로를 지정해주면, NAT Gateway에서 지정된 Public IP를 통해서 AWS 리소스들과 "통신" 가능하게 되어 결국 리소스들과 연결이 된 것이 아닐까라는 추측이었고, 검색 해보니 NAT Gateway와 VPC Endpoint는 서로 대체제처럼 이용되고 있는 경우가 많이 있었다. NAT Gateway를 이용하게 되면 Public 망을 거쳐서 통신, VPC Endpoint는 내부 통신이 이루어 진다는 차이가 생기긴 한다. 그리고 금액도! (감사합니다 갓 AWSKRUG...).

NAT Gateway를 만드는 건 간단하다. Public Subnet 안에 Elastic IP를 붙여서 만들면 된다. 그리고 만들어진 NAT Gateway를 프라이빗 라우팅 테이블에 Internet Gateway 설정해주듯, 설정해주면 된다. `0.0.0.0/0`을 NAT Gateway를 통해 찾도록 만들면 된다. 조금 더 자세한 내용을 확인하려면 이 [링크](https://medium.com/@philippholly/aws-lambda-enable-outgoing-internet-access-within-vpc-8dd250e11e12)를 확인해보면 좋을 것 같다.

이렇게 설정해주고 나면, VPC 내부에서 배포했지만, 외부에서도 접근 가능한 버전이 생긴다.

## Reference

- <https://serverless.com/framework/docs/providers/aws/guide/functions#vpc-configuration>
- <https://medium.com/@philippholly/aws-lambda-enable-outgoing-internet-access-within-vpc-8dd250e11e12>
